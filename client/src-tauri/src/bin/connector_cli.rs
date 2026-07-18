//! Standalone-запуск коннектора для отладки без окна Tauri:
//! cargo run --bin connector_cli -- <player> [server_url] [projects_dir]
//!
//! Сам авторизуется dev-заглушкой и печатает статусы в консоль.

use std::sync::mpsc;

use app_lib::connector::{self, ConnectorConfig};

fn main() {
    let mut args = std::env::args().skip(1);
    let player = args.next().unwrap_or_else(|| "misha".into());
    let server_url = args.next().unwrap_or_else(|| "http://127.0.0.1:8787".into());
    let projects_dir = args
        .next()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(connector::default_projects_dir);

    // Dev-авторизация (ТЗ: Steam — отдельной фазой)
    let auth: serde_json::Value = reqwest::blocking::Client::new()
        .post(format!("{server_url}/auth/dev"))
        .json(&serde_json::json!({ "playerId": player }))
        .send()
        .expect("auth request failed")
        .json()
        .expect("auth response is not json");
    let token = auth["token"].as_str().expect("no token in auth response").to_string();

    let db_path = std::env::temp_dir().join(format!("tc-connector-{player}.sqlite"));
    println!("[connector] игрок dev:{player}, логи: {}", projects_dir.display());
    println!("[connector] состояние: {}", db_path.display());

    let (status_tx, status_rx) = mpsc::channel();
    let (_stop_tx, stop_rx) = mpsc::channel::<()>();

    std::thread::spawn(move || {
        connector::run_loop(
            ConnectorConfig { server_url, token, projects_dir, db_path },
            status_tx,
            stop_rx,
        );
    });

    while let Ok(status) = status_rx.recv() {
        println!(
            "[connector] agent={} files={} fresh={} outbox={:.3} accepted={:.3} clipped={:.3}{}",
            if status.agent_detected {
                format!("АКТИВЕН({}s)", status.last_activity_secs.unwrap_or(0))
            } else {
                "ТИШИНА".to_string()
            },
            status.files_tracked,
            status.fresh_records,
            status.outbox_ovm,
            status.last_accepted,
            status.last_clipped,
            status
                .last_error
                .as_deref()
                .map(|e| format!(" ERR: {e}"))
                .unwrap_or_default()
        );
    }
}
