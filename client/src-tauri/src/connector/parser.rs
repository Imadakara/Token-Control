//! Инкрементальный парсер JSONL-логов Claude Code (ТЗ п. 7.2).
//!
//! Приватность: десериализуются ТОЛЬКО перечисленные ниже поля (usage, model,
//! timestamp, идентификаторы); текст сообщений в структуры не попадает.

use serde::Deserialize;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

/// Запись о расходе токенов одним ответом ассистента.
#[derive(Debug, Clone, PartialEq)]
pub struct UsageRecord {
    /// Ключ дедупликации: requestId, иначе uuid (resume/fork дублируют записи).
    pub dedup_id: String,
    pub model: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
}

#[derive(Deserialize)]
struct RawRecord<'a> {
    #[serde(rename = "type")]
    kind: Option<&'a str>,
    uuid: Option<String>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    message: Option<RawMessage>,
}

#[derive(Deserialize)]
struct RawMessage {
    model: Option<String>,
    usage: Option<RawUsage>,
}

#[derive(Deserialize, Default)]
struct RawUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
}

/// Разбирает одну ПОЛНУЮ строку JSONL. Не-assistant записи, записи без usage
/// и любой мусор тихо пропускаются (в файлах встречаются чужие форматы).
pub fn parse_line(line: &str) -> Option<UsageRecord> {
    let raw: RawRecord = serde_json::from_str(line).ok()?;
    if raw.kind != Some("assistant") {
        return None;
    }
    let message = raw.message?;
    let usage = message.usage?;
    let dedup_id = raw.request_id.or(raw.uuid)?;
    Some(UsageRecord {
        dedup_id,
        model: message.model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_tokens: usage.cache_creation_input_tokens,
        cache_read_tokens: usage.cache_read_input_tokens,
    })
}

/// Дочитывает файл с байтового офсета, возвращая записи и новый офсет.
/// Офсет продвигается только за полные строки (устойчивость к недописанной
/// последней строке, ТЗ п. 7.2).
pub fn read_from_offset(path: &Path, offset: u64) -> std::io::Result<(Vec<UsageRecord>, u64)> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    // Файл усечён (ротация/перезапись) — начинаем сначала
    let start = if offset > len { 0 } else { offset };
    file.seek(SeekFrom::Start(start))?;

    let mut reader = BufReader::new(file);
    let mut records = Vec::new();
    let mut consumed = start;
    let mut buf = Vec::new();

    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf)?;
        if n == 0 {
            break;
        }
        if buf.last() != Some(&b'\n') {
            // Незавершённая строка — не двигаем офсет, дочитаем в следующий раз
            break;
        }
        consumed += n as u64;
        if let Ok(line) = std::str::from_utf8(&buf) {
            if let Some(record) = parse_line(line.trim_end()) {
                records.push(record);
            }
        }
    }

    Ok((records, consumed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const ASSISTANT_LINE: &str = r#"{"type":"assistant","uuid":"u-1","requestId":"req-1","timestamp":"2026-07-17T10:00:00Z","message":{"model":"claude-fable-5","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":10,"cache_read_input_tokens":2000},"content":[{"type":"text","text":"secret"}]}}"#;

    #[test]
    fn parses_assistant_usage() {
        let r = parse_line(ASSISTANT_LINE).unwrap();
        assert_eq!(r.dedup_id, "req-1");
        assert_eq!(r.model.as_deref(), Some("claude-fable-5"));
        assert_eq!(
            (r.input_tokens, r.output_tokens, r.cache_creation_tokens, r.cache_read_tokens),
            (100, 50, 10, 2000)
        );
    }

    #[test]
    fn skips_foreign_records() {
        assert!(parse_line(r#"{"type":"user","uuid":"u","message":{"content":"hi"}}"#).is_none());
        assert!(parse_line(r#"{"operation":"write","content":"stuff"}"#).is_none());
        assert!(parse_line("not json at all").is_none());
        assert!(parse_line(r#"{"type":"assistant","uuid":"u-2","message":{"model":"m"}}"#).is_none());
    }

    #[test]
    fn uuid_fallback_when_no_request_id() {
        let line = r#"{"type":"assistant","uuid":"u-9","message":{"usage":{"input_tokens":1}}}"#;
        assert_eq!(parse_line(line).unwrap().dedup_id, "u-9");
    }

    #[test]
    fn incomplete_last_line_not_consumed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let mut f = File::create(&path).unwrap();
        writeln!(f, "{ASSISTANT_LINE}").unwrap();
        write!(f, "{{\"type\":\"assistant\",\"uuid\":\"partial").unwrap();
        f.flush().unwrap();

        let (records, offset) = read_from_offset(&path, 0).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(offset, (ASSISTANT_LINE.len() + 1) as u64);

        // Строка дописана — дочитываем ровно хвост
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(f, "\",\"message\":{{\"usage\":{{\"input_tokens\":5}}}}}}").unwrap();
        let (records, offset2) = read_from_offset(&path, offset).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].dedup_id, "partial");
        assert!(offset2 > offset);
    }

    #[test]
    fn truncated_file_restarts_from_zero() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        std::fs::write(&path, format!("{ASSISTANT_LINE}\n")).unwrap();
        let (records, _) = read_from_offset(&path, 999_999).unwrap();
        assert_eq!(records.len(), 1);
    }
}
