//! Коннектор Claude Code (ТЗ п. 7): фоновый цикл «скан JSONL → дедуп →
//! конвертация в ОВМ → оффлайн-outbox → батчевая отправка на сервер».
//!
//! Скан — рескан-таймером по размеру файлов (устойчив к пропущенным FS-событиям
//! на Windows); watcher — необязательная оптимизация, в MVP не используется.

pub mod parser;
pub mod store;
pub mod submit;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender};
use std::time::{Duration, SystemTime};

use store::Store;
use submit::{ConversionConfig, GameClient};

pub const SCAN_INTERVAL: Duration = Duration::from_secs(5);
pub const SUBMIT_INTERVAL: Duration = Duration::from_secs(15);
/// Агент считается работающим, если файлы логов росли в этом окне.
pub const ACTIVITY_WINDOW: Duration = Duration::from_secs(120);

/// Статус коннектора для UI (экран СТАТУС/НАСТРОЙКИ, ТЗ п. 4.2.5/4.2.7).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorStatus {
    pub running: bool,
    /// Активность по факту РОСТА файлов логов (не по их наличию!).
    pub agent_detected: bool,
    /// Сколько секунд назад была последняя активность агента (None — не было).
    pub last_activity_secs: Option<u64>,
    pub files_tracked: usize,
    pub fresh_records: u64,
    pub outbox_ovm: f64,
    pub last_accepted: f64,
    pub last_clipped: f64,
    pub last_error: Option<String>,
}

pub struct ConnectorConfig {
    pub server_url: String,
    pub token: String,
    /// Корень логов Claude Code; по умолчанию ~/.claude/projects (ТЗ п. 7.2).
    pub projects_dir: PathBuf,
    pub db_path: PathBuf,
}

pub fn default_projects_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
        .join("projects")
}

fn jsonl_files(root: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "jsonl"))
        .map(|e| e.into_path())
        .collect()
}

fn now_iso() -> String {
    humantime::format_rfc3339_seconds(SystemTime::now()).to_string()
}

/// Результат цикла сканирования.
pub struct ScanOutcome {
    pub files: usize,
    pub fresh: u64,
    /// Хоть один файл вырос — агент что-то писал (активность).
    pub grew: bool,
}

/// Один цикл сканирования: дочитать выросшие файлы, задедупить, начислить.
/// При `credit = false` (baseline при первом запуске) история индексируется
/// без начисления — засчитываются только токены после установки.
pub fn scan_cycle(
    store: &mut Store,
    projects_dir: &Path,
    conversion: &ConversionConfig,
    credit: bool,
    interval_start: &str,
) -> Result<ScanOutcome, String> {
    let files = jsonl_files(projects_dir);
    let mut all_records = Vec::new();
    let mut new_offsets = Vec::new();
    let mut grew = false;

    for path in &files {
        let path_str = path.to_string_lossy().to_string();
        let stored = store.offset(&path_str).map_err(|e| e.to_string())?;
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if size == stored {
            continue;
        }
        grew = true;
        match parser::read_from_offset(path, stored) {
            Ok((records, consumed)) => {
                all_records.extend(records);
                new_offsets.push((path_str, consumed));
            }
            Err(_) => continue, // файл занят/удалён — попробуем в следующий цикл
        }
    }

    let fresh = store
        .commit_scan(
            &new_offsets,
            &all_records,
            (interval_start, &now_iso()),
            (conversion.k_cache_w, conversion.k_cache_r, conversion.n),
            credit,
        )
        .map_err(|e| e.to_string())?;

    Ok(ScanOutcome { files: files.len(), fresh: fresh as u64, grew })
}

/// Отправляет накопленный outbox по порядку; останавливается на первой ошибке
/// (сеть/сервер) — пакеты остаются и уйдут при следующей попытке.
pub fn flush_outbox(store: &Store, client: &GameClient) -> (f64, f64, Option<String>) {
    let (mut accepted, mut clipped) = (0.0, 0.0);
    loop {
        let packets = match store.outbox(20) {
            Ok(p) => p,
            Err(e) => return (accepted, clipped, Some(e.to_string())),
        };
        if packets.is_empty() {
            return (accepted, clipped, None);
        }
        for packet in packets {
            match client.submit(&packet) {
                Ok(result) => {
                    accepted += result.accepted;
                    clipped += result.clipped;
                    if let Err(e) = store.ack_packet(packet.seq) {
                        return (accepted, clipped, Some(e.to_string()));
                    }
                }
                Err(e) => return (accepted, clipped, Some(e)),
            }
        }
    }
}

/// Фоновый цикл коннектора; статус отправляется в канал после каждого шага.
/// `stop` — мягкая остановка (drop отправителя в UI).
pub fn run_loop(config: ConnectorConfig, status_tx: Sender<ConnectorStatus>, stop: Receiver<()>) {
    let mut status = ConnectorStatus { running: true, ..Default::default() };
    let emit = |s: &ConnectorStatus| {
        let _ = status_tx.send(s.clone());
    };

    let mut store = match Store::open(&config.db_path) {
        Ok(s) => s,
        Err(e) => {
            status.running = false;
            status.last_error = Some(format!("sqlite: {e}"));
            emit(&status);
            return;
        }
    };

    let client = GameClient::new(&config.server_url, &config.token);
    let mut conversion = ConversionConfig { k_cache_w: 1.0, k_cache_r: 0.1, n: 1000.0 };
    match client.fetch_conversion() {
        Ok(c) => conversion = c,
        Err(e) => status.last_error = Some(format!("config: {e}")),
    }

    // Baseline: история до установки индексируется без начисления
    let baseline_done = store.meta("baseline_done").ok().flatten().is_some();
    if !baseline_done {
        let started = now_iso();
        match scan_cycle(&mut store, &config.projects_dir, &conversion, false, &started) {
            Ok(_) => {
                let _ = store.set_meta("baseline_done", "1");
            }
            Err(e) => status.last_error = Some(format!("baseline: {e}")),
        }
    }

    let mut interval_start = now_iso();
    let mut last_submit = std::time::Instant::now();
    let mut last_activity: Option<std::time::Instant> = None;

    loop {
        if stop.try_recv().is_ok() {
            status.running = false;
            emit(&status);
            return;
        }

        let mut flush_now = false;
        match scan_cycle(&mut store, &config.projects_dir, &conversion, true, &interval_start) {
            Ok(outcome) => {
                status.files_tracked = outcome.files;
                status.fresh_records += outcome.fresh;
                if outcome.grew {
                    last_activity = Some(std::time::Instant::now());
                }
                if outcome.fresh > 0 {
                    interval_start = now_iso();
                    flush_now = true; // свежие токены — отправляем сразу, без ожидания
                }
                status.last_error = None;
            }
            Err(e) => status.last_error = Some(e),
        }

        // «Агент работает» = логи росли недавно, а не «файлы существуют»
        status.agent_detected =
            last_activity.is_some_and(|t| t.elapsed() <= ACTIVITY_WINDOW);
        status.last_activity_secs = last_activity.map(|t| t.elapsed().as_secs());

        if flush_now || last_submit.elapsed() >= SUBMIT_INTERVAL {
            let (accepted, clipped, error) = flush_outbox(&store, &client);
            if accepted > 0.0 || clipped > 0.0 {
                status.last_accepted = accepted;
                status.last_clipped = clipped;
            }
            if let Some(e) = error {
                status.last_error = Some(format!("submit: {e}"));
            }
            last_submit = std::time::Instant::now();
            // Обновляем коэффициенты (конфиг мог поменяться на сервере)
            if let Ok(c) = client.fetch_conversion() {
                conversion = c;
            }
        }

        status.outbox_ovm = store.outbox_ovm_total().unwrap_or(0.0);
        emit(&status);
        std::thread::sleep(SCAN_INTERVAL);
    }
}
