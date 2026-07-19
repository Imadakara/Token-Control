//! Встроенный движок ассистента (ТЗ v0.02 п. 7, Strategy - Plan.md): игра
//! везёт с собой CPU-only sidecar-сборку Ollama (без CUDA/ROCm/Vulkan —
//! только они и делают полный дистрибутив тяжёлым, см. план), чтобы игроку
//! не нужно было ничего ставить отдельно. Если у игрока уже отвечает
//! Ollama по настроенному адресу (свой, возможно с GPU-ускорением) — эта
//! команда его не трогает и ничего не поднимает поверх.
//!
//! Модель НЕ входит в комплект и не скачивается этой командой — это большая
//! (~2 ГБ) загрузка, которую инициирует только явный клик игрока
//! (`assistant.svelte.ts::pullModel`).
//!
//! Sidecar намеренно НЕ переопределяет `OLLAMA_MODELS` — раньше он указывал
//! на изолированную папку внутри `app_data_dir()`, из-за чего модель, уже
//! скачанная игроком через отдельно установленный/вручную запущенный Ollama
//! (стандартное место хранения), оказывалась «не видна» встроенному
//! движку, и игра предлагала скачать её заново. Без переопределения sidecar
//! использует то же стандартное место хранения моделей, что и любая другая
//! копия Ollama на машине игрока — модели, скачанные один раз, видны отовсюду.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    /// "running" | "unavailable" — сервер отвечает или нет после попытки.
    pub state: String,
    /// None, если сервер так и не поднялся — проверить модель не удалось.
    pub model_available: Option<bool>,
}

#[derive(Deserialize)]
struct ModelsResponse {
    // Ollama отдаёт `"data": null`, если моделей ещё нет (не пустой массив) —
    // без Option<...> serde уронит разбор на пустом sidecar'е сразу после
    // старта, и код решит, что сервер вообще не отвечает.
    #[serde(default)]
    data: Option<Vec<ModelEntry>>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: String,
}

fn http_client() -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()
}

fn list_models(base_url: &str) -> Option<Vec<String>> {
    let client = http_client()?;
    let res = client
        .get(format!("{}/models", base_url.trim_end_matches('/')))
        .send()
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let body: ModelsResponse = res.json().ok()?;
    Some(body.data.unwrap_or_default().into_iter().map(|m| m.id).collect())
}

/// Поднимает встроенный Ollama, если по настроенному адресу никто не отвечает
/// (см. модульный комментарий — чужой уже запущенный Ollama не трогаем).
#[tauri::command]
pub fn ollama_ensure_running(
    app: tauri::AppHandle,
    base_url: String,
    model: String,
) -> OllamaStatus {
    if let Some(models) = list_models(&base_url) {
        return OllamaStatus {
            state: "running".into(),
            model_available: Some(models.iter().any(|m| m == &model)),
        };
    }

    let cmd = match app.shell().sidecar("ollama") {
        Ok(c) => c.args(["serve"]),
        Err(_) => {
            return OllamaStatus {
                state: "unavailable".into(),
                model_available: None,
            }
        }
    };

    // Процесс намеренно не отслеживается и не останавливается приложением —
    // фоновый сервис, живёт и после закрытия игры, как и обычный Ollama.
    if cmd.spawn().is_err() {
        return OllamaStatus {
            state: "unavailable".into(),
            model_available: None,
        };
    }

    for _ in 0..10 {
        std::thread::sleep(Duration::from_millis(500));
        if let Some(models) = list_models(&base_url) {
            return OllamaStatus {
                state: "running".into(),
                model_available: Some(models.iter().any(|m| m == &model)),
            };
        }
    }
    OllamaStatus {
        state: "unavailable".into(),
        model_available: None,
    }
}
