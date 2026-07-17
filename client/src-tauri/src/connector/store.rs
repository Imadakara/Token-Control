//! Локальное состояние коннектора в SQLite: байтовые офсеты файлов,
//! глобальный дедуп-индекс, оффлайн-outbox пакетов и дробный остаток ОВМ.
//! Переживает рестарты клиента (ТЗ п. 11).

use rusqlite::{params, Connection};
use std::path::Path;

pub struct Store {
    conn: Connection,
}

/// Пакет начисления в outbox (ТЗ п. 7.4).
#[derive(Debug, Clone)]
pub struct OutboxPacket {
    pub seq: i64,
    pub ovm: f64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
    pub interval_start: String,
    pub interval_end: String,
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS file_offsets (
               path TEXT PRIMARY KEY,
               offset INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS seen (
               id TEXT PRIMARY KEY
             );
             CREATE TABLE IF NOT EXISTS outbox (
               seq INTEGER PRIMARY KEY AUTOINCREMENT,
               ovm REAL NOT NULL,
               input_tokens INTEGER NOT NULL,
               output_tokens INTEGER NOT NULL,
               cache_creation_tokens INTEGER NOT NULL,
               cache_read_tokens INTEGER NOT NULL,
               interval_start TEXT NOT NULL,
               interval_end TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS meta (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );",
        )?;
        Ok(Self { conn })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.conn.execute_batch(
            "CREATE TABLE file_offsets (path TEXT PRIMARY KEY, offset INTEGER NOT NULL);
             CREATE TABLE seen (id TEXT PRIMARY KEY);
             CREATE TABLE outbox (
               seq INTEGER PRIMARY KEY AUTOINCREMENT,
               ovm REAL NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
               cache_creation_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL,
               interval_start TEXT NOT NULL, interval_end TEXT NOT NULL
             );
             CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        Ok(store)
    }

    pub fn offset(&self, path: &str) -> rusqlite::Result<u64> {
        self.conn
            .query_row(
                "SELECT offset FROM file_offsets WHERE path = ?1",
                [path],
                |row| row.get::<_, i64>(0),
            )
            .map(|v| v as u64)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(0),
                other => Err(other),
            })
    }

    pub fn meta(&self, key: &str) -> rusqlite::Result<Option<String>> {
        match self.conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| row.get(0)) {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn set_meta(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Атомарно применяет результат цикла сканирования: офсеты, новые id,
    /// и (если есть незадублированный расход) пакет в outbox.
    /// Возвращает число НОВЫХ (не дублированных) записей.
    pub fn commit_scan(
        &mut self,
        offsets: &[(String, u64)],
        records: &[crate::connector::parser::UsageRecord],
        interval: (&str, &str),
        conversion: (f64, f64, f64), // (k_cache_w, k_cache_r, n)
        credit: bool,
    ) -> rusqlite::Result<usize> {
        let tx = self.conn.transaction()?;
        let mut fresh = 0usize;
        let (mut t_in, mut t_out, mut t_cw, mut t_cr) = (0i64, 0i64, 0i64, 0i64);

        for record in records {
            let inserted = tx.execute(
                "INSERT OR IGNORE INTO seen (id) VALUES (?1)",
                [&record.dedup_id],
            )?;
            if inserted > 0 {
                fresh += 1;
                t_in += record.input_tokens as i64;
                t_out += record.output_tokens as i64;
                t_cw += record.cache_creation_tokens as i64;
                t_cr += record.cache_read_tokens as i64;
            }
        }

        for (path, offset) in offsets {
            tx.execute(
                "INSERT INTO file_offsets (path, offset) VALUES (?1, ?2)
                 ON CONFLICT(path) DO UPDATE SET offset = excluded.offset",
                params![path, *offset as i64],
            )?;
        }

        if credit && (t_in + t_out + t_cw + t_cr) > 0 {
            // Формула ТЗ п. 7.3 + дробный остаток из meta
            let (k_cache_w, k_cache_r, n) = conversion;
            let t_weighted = t_in as f64
                + t_out as f64
                + k_cache_w * t_cw as f64
                + k_cache_r * t_cr as f64;
            let remainder: f64 = tx
                .query_row("SELECT value FROM meta WHERE key = 'remainder'", [], |r| {
                    r.get::<_, String>(0)
                })
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.0);
            let total = t_weighted / n + remainder;
            // В пакет — с точностью 0.001 (numeric(14,3) на сервере), хвост в остаток
            let ovm = (total * 1000.0).floor() / 1000.0;
            let new_remainder = total - ovm;
            tx.execute(
                "INSERT INTO meta (key, value) VALUES ('remainder', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [new_remainder.to_string()],
            )?;
            if ovm > 0.0 {
                tx.execute(
                    "INSERT INTO outbox (ovm, input_tokens, output_tokens,
                       cache_creation_tokens, cache_read_tokens, interval_start, interval_end)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![ovm, t_in, t_out, t_cw, t_cr, interval.0, interval.1],
                )?;
            }
        }

        tx.commit()?;
        Ok(fresh)
    }

    pub fn outbox(&self, limit: usize) -> rusqlite::Result<Vec<OutboxPacket>> {
        let mut stmt = self.conn.prepare(
            "SELECT seq, ovm, input_tokens, output_tokens, cache_creation_tokens,
                    cache_read_tokens, interval_start, interval_end
             FROM outbox ORDER BY seq LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit as i64], |row| {
            Ok(OutboxPacket {
                seq: row.get(0)?,
                ovm: row.get(1)?,
                input_tokens: row.get(2)?,
                output_tokens: row.get(3)?,
                cache_creation_tokens: row.get(4)?,
                cache_read_tokens: row.get(5)?,
                interval_start: row.get(6)?,
                interval_end: row.get(7)?,
            })
        })?;
        rows.collect()
    }

    /// Пакет удаляется из outbox только после ack сервера (ТЗ: идемпотентность).
    pub fn ack_packet(&self, seq: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM outbox WHERE seq = ?1", [seq])?;
        Ok(())
    }

    pub fn outbox_ovm_total(&self) -> rusqlite::Result<f64> {
        self.conn
            .query_row("SELECT COALESCE(SUM(ovm), 0) FROM outbox", [], |row| row.get(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connector::parser::UsageRecord;

    fn record(id: &str, input: u64) -> UsageRecord {
        UsageRecord {
            dedup_id: id.into(),
            model: None,
            input_tokens: input,
            output_tokens: 0,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
        }
    }

    #[test]
    fn dedup_is_global_and_persistent() {
        let mut store = Store::open_in_memory().unwrap();
        let conv = (1.0, 0.1, 1000.0);
        let fresh = store
            .commit_scan(&[], &[record("a", 500), record("b", 500)], ("t0", "t1"), conv, true)
            .unwrap();
        assert_eq!(fresh, 2);
        // Те же id из «другого файла» (resume) не задваиваются
        let fresh = store
            .commit_scan(&[], &[record("a", 500), record("c", 1000)], ("t1", "t2"), conv, true)
            .unwrap();
        assert_eq!(fresh, 1);
        assert!((store.outbox_ovm_total().unwrap() - 2.0).abs() < 1e-9);
    }

    #[test]
    fn remainder_carries_between_packets() {
        let mut store = Store::open_in_memory().unwrap();
        let conv = (1.0, 0.1, 1000.0);
        // 500 токенов → 0.5 ОВМ
        store.commit_scan(&[], &[record("x", 500)], ("t0", "t1"), conv, true).unwrap();
        store.commit_scan(&[], &[record("y", 501)], ("t1", "t2"), conv, true).unwrap();
        let total = store.outbox_ovm_total().unwrap();
        assert!((total - 1.001).abs() < 1e-9, "got {total}");
    }

    #[test]
    fn baseline_records_ids_without_credit() {
        let mut store = Store::open_in_memory().unwrap();
        let conv = (1.0, 0.1, 1000.0);
        store
            .commit_scan(&[("f".into(), 100)], &[record("hist", 99999)], ("t0", "t0"), conv, false)
            .unwrap();
        assert_eq!(store.outbox(10).unwrap().len(), 0);
        assert_eq!(store.offset("f").unwrap(), 100);
        // История не начисляется и при повторном появлении
        let fresh = store.commit_scan(&[], &[record("hist", 99999)], ("t1", "t2"), conv, true).unwrap();
        assert_eq!(fresh, 0);
        assert_eq!(store.outbox(10).unwrap().len(), 0);
    }

    #[test]
    fn ack_removes_packet() {
        let mut store = Store::open_in_memory().unwrap();
        store
            .commit_scan(&[], &[record("z", 2000)], ("t0", "t1"), (1.0, 0.1, 1000.0), true)
            .unwrap();
        let packets = store.outbox(10).unwrap();
        assert_eq!(packets.len(), 1);
        store.ack_packet(packets[0].seq).unwrap();
        assert_eq!(store.outbox(10).unwrap().len(), 0);
    }
}
