//! HTTP-клиент коннектора: конфиг конвертации и отправка пакетов ОВМ.
//! На сервер уходят только числа (ТЗ п. 7.4, п. 10).

use serde::{Deserialize, Serialize};

use super::store::OutboxPacket;

#[derive(Debug, Clone, Deserialize)]
pub struct ConversionConfig {
    #[serde(rename = "kCacheW")]
    pub k_cache_w: f64,
    #[serde(rename = "kCacheR")]
    pub k_cache_r: f64,
    pub n: f64,
}

#[derive(Deserialize)]
struct ConfigResponse {
    conversion: ConversionConfig,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TokensBody {
    input: i64,
    output: i64,
    cache_creation: i64,
    cache_read: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubmitBody {
    packet_seq: i64,
    ovm: f64,
    tokens: TokensBody,
    interval_start: String,
    interval_end: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SubmitResult {
    pub accepted: f64,
    pub clipped: f64,
}

pub struct GameClient {
    http: reqwest::blocking::Client,
    base_url: String,
    token: String,
}

impl GameClient {
    pub fn new(base_url: &str, token: &str) -> Self {
        Self {
            http: reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("reqwest client"),
            base_url: base_url.trim_end_matches('/').to_string(),
            token: token.to_string(),
        }
    }

    /// Коэффициенты формулы — с сервера: калибровка без обновления клиента (ТЗ п. 7.3).
    pub fn fetch_conversion(&self) -> Result<ConversionConfig, String> {
        let res = self
            .http
            .get(format!("{}/config", self.base_url))
            .send()
            .map_err(|e| e.to_string())?;
        let config: ConfigResponse = res.json().map_err(|e| e.to_string())?;
        Ok(config.conversion)
    }

    pub fn submit(&self, packet: &OutboxPacket) -> Result<SubmitResult, String> {
        let body = SubmitBody {
            packet_seq: packet.seq,
            ovm: packet.ovm,
            tokens: TokensBody {
                input: packet.input_tokens,
                output: packet.output_tokens,
                cache_creation: packet.cache_creation_tokens,
                cache_read: packet.cache_read_tokens,
            },
            interval_start: packet.interval_start.clone(),
            interval_end: packet.interval_end.clone(),
        };
        let res = self
            .http
            .post(format!("{}/credits/submit", self.base_url))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("HTTP {}", res.status()));
        }
        res.json().map_err(|e| e.to_string())
    }
}
