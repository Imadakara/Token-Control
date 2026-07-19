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
        .plugin(tauri_plugin_http::init())
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

            // Трей и «тихий» режим (ТЗ п. 11): терминал живёт в фоне,
            // коннектор продолжает считать ОВМ при скрытом окне.
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;
            let show = MenuItem::with_id(app, "show", "Показать терминал", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().expect("window icon").clone())
                .tooltip("TOKEN CONTROL")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Закрытие окна = сворачивание в трей, а не выход
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
