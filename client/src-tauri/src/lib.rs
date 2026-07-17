pub mod connector;

use std::sync::mpsc;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

use connector::{ConnectorConfig, ConnectorStatus};

/// Ручка работающего коннектора: drop отправителя останавливает цикл.
#[derive(Default)]
struct ConnectorHandle(Mutex<Option<mpsc::Sender<()>>>);

/// Запуск коннектора после логина в веб-UI: передаёт адрес сервера и токен.
#[tauri::command]
fn connector_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ConnectorHandle>,
    server_url: String,
    token: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(()); // уже работает
    }

    let db_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;

    let config = ConnectorConfig {
        server_url,
        token,
        projects_dir: connector::default_projects_dir(),
        db_path: db_dir.join("connector.sqlite"),
    };

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (status_tx, status_rx) = mpsc::channel::<ConnectorStatus>();
    *guard = Some(stop_tx);

    std::thread::spawn(move || connector::run_loop(config, status_tx, stop_rx));

    // Пробрасываем статусы коннектора в веб-UI событиями
    let emitter = app.clone();
    std::thread::spawn(move || {
        while let Ok(status) = status_rx.recv() {
            let _ = emitter.emit("connector-status", &status);
        }
    });

    Ok(())
}

#[tauri::command]
fn connector_stop(state: tauri::State<'_, ConnectorHandle>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(stop) = guard.take() {
        let _ = stop.send(());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ConnectorHandle::default())
        .invoke_handler(tauri::generate_handler![connector_start, connector_stop])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
