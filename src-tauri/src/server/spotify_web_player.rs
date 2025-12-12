use base32::Alphabet;
use hmac::{Hmac, Mac};
use sha1::Sha1;
// use rand::RngCore; // Unused
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
// use std::time::{SystemTime, UNIX_EPOCH}; // Unused
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use std::sync::{Arc, Mutex};

const TOKEN_URL: &str = "https://open.spotify.com/api/token";
const SERVER_TIME_URL: &str = "https://open.spotify.com/";
const SECRET_CIPHER_DICT_URL: &str =
    "https://github.com/xyloflake/spot-secrets-go/blob/main/secrets/secretDict.json?raw=true";

type HmacSha1 = Hmac<Sha1>;

#[derive(Debug, Clone)]
pub struct SpotifyWebPlayer {
    secret_cipher_dict: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    client: reqwest::Client,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenResponse {
    access_token: Option<String>,
    access_token_expiration_timestamp_ms: Option<i64>,
    client_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TokenError {
    error: String,
    message: String,
}

impl SpotifyWebPlayer {
    pub fn new(sp_dc: String) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0",
            ),
        );

        let jar = reqwest::cookie::Jar::default();
        let url = "https://open.spotify.com".parse::<reqwest::Url>().unwrap();
        jar.add_cookie_str(&format!("sp_dc={}", sp_dc), &url);

        Self {
            secret_cipher_dict: Arc::new(Mutex::new(HashMap::new())),
            client: reqwest::Client::builder()
                .default_headers(headers)
                .cookie_provider(Arc::new(jar))
                .build()
                .unwrap(),
        }
    }

    pub async fn init_secrets(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Initial fallback secrets
        let initial_secrets: HashMap<String, Vec<u8>> = [
            (
                "14".to_string(),
                vec![
                    62, 54, 109, 83, 107, 77, 41, 103, 45, 93, 114, 38, 41, 97, 64, 51, 95, 94, 95,
                    94,
                ],
            ),
            (
                "13".to_string(),
                vec![
                    59, 92, 64, 70, 99, 78, 117, 75, 99, 103, 116, 67, 103, 51, 87, 63, 93, 59, 70,
                    45, 32,
                ],
            ),
            (
                "61".to_string(),
                vec![
                    44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94, 102, 43,
                    69, 49, 120, 118, 80, 64, 78,
                ],
            ),
        ]
        .into_iter()
        .collect();

        {
            let mut secrets = self.secret_cipher_dict.lock().unwrap();
            *secrets = initial_secrets;
        }

        self.update_secrets().await?;
        Ok(())
    }

    async fn update_secrets(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let resp = self.client.get(SECRET_CIPHER_DICT_URL).send().await?;

        if resp.status().is_success() {
            let payload: HashMap<String, Vec<u8>> = resp.json().await?;
            let mut secrets = self.secret_cipher_dict.lock().unwrap();
            for (k, v) in payload {
                secrets.insert(k, v);
            }
        }
        Ok(())
    }

    fn ensure_totp_version(&self, requested_ver: Option<i32>) -> Result<i32, String> {
        let secrets = self.secret_cipher_dict.lock().unwrap();
        let mut available: Vec<i32> = secrets
            .keys()
            .filter_map(|k| k.parse::<i32>().ok())
            .collect();
        available.sort();

        if available.is_empty() {
            return Err("Secret cipher dictionary is empty".to_string());
        }

        if let Some(ver) = requested_ver {
            if secrets.contains_key(&ver.to_string()) {
                return Ok(ver);
            } else {
                return Err(format!("No secret cipher available for version {}", ver));
            }
        }

        Ok(*available.last().unwrap())
    }

    fn xor_transform_secret(&self, cipher_bytes: &[u8]) -> Vec<u8> {
        cipher_bytes
            .iter()
            .enumerate()
            .map(|(i, &byte)| byte ^ ((i as u8 % 33) + 9))
            .collect()
    }

    fn derive_totp_secret(&self, version: i32) -> Result<String, String> {
        let secrets = self.secret_cipher_dict.lock().unwrap();
        let cipher_bytes = secrets
            .get(&version.to_string())
            .ok_or_else(|| format!("Missing cipher bytes for version {}", version))?;

        let transformed = self.xor_transform_secret(cipher_bytes);
        let digits: String = transformed.iter().map(|b| b.to_string()).collect();
        let ascii_bytes = digits.as_bytes();

        Ok(base32::encode(
            Alphabet::RFC4648 { padding: false },
            ascii_bytes,
        ))
    }

    async fn fetch_server_time(&self) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
        let resp = self.client.head(SERVER_TIME_URL).send().await?;
        let date_header = resp.headers().get("date").ok_or("Missing Date header")?;
        let date_str = date_header.to_str()?;
        let dt = chrono::DateTime::parse_from_rfc2822(date_str)?;
        Ok(dt.timestamp() as u64)
    }

    fn generate_totp(
        &self,
        secret: &str,
        timestamp: u64,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let time_step = timestamp / 30;
        let counter = time_step.to_be_bytes();

        let key_data = base32::decode(Alphabet::RFC4648 { padding: false }, secret)
            .ok_or("Failed to decode base32 secret")?;

        let mut mac = HmacSha1::new_from_slice(&key_data)?;
        mac.update(&counter);
        let result = mac.finalize().into_bytes();

        let offset = (result[result.len() - 1] & 0x0f) as usize;
        let binary = ((result[offset] & 0x7f) as u32) << 24
            | ((result[offset + 1] as u32) & 0xff) << 16
            | ((result[offset + 2] as u32) & 0xff) << 8
            | ((result[offset + 3] as u32) & 0xff);

        let otp = binary % 1_000_000;
        Ok(format!("{:06}", otp))
    }

    pub async fn get_access_token(
        &self,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let version = self.ensure_totp_version(Some(61))?; // Default to 61 as in JS
        let secret = self.derive_totp_secret(version)?;
        let server_time = self.fetch_server_time().await?;
        let otp = self.generate_totp(&secret, server_time)?;

        // Using literal keys lets HashMap be HashMap<&str, String>
        let mut params = HashMap::new();
        params.insert("reason", "transport".to_string());
        params.insert("productType", "web-player".to_string());
        params.insert("totp", otp.clone());
        params.insert("totpServer", otp);
        params.insert("totpVer", version.to_string());

        // legacy params building omitted as we likely use new version, but can add if needed
        // JS version < 10 uses legacy params.

        let url = reqwest::Url::parse_with_params(TOKEN_URL, &params)?;

        let resp = self
            .client
            .get(url)
            .header("Accept", "application/json")
            .header("App-Platform", "WebPlayer")
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(format!("Failed to get token: {}", resp.status()).into());
        }

        let json: TokenResponse = resp.json().await?;

        if json.access_token.is_none() {
            // Retry with reason=init if failed?
            // JS does this:
            // if (!tokenData.ok || !tokenData.data?.accessToken) {
            //    const initParams = { ...baseParams, reason: "init" };
            //    tokenData = await requestToken(initParams);
            // }
            // Implementing retry logic:
            let mut init_params = params.clone();
            init_params.insert("reason", "init".to_string());
            let url_init = reqwest::Url::parse_with_params(TOKEN_URL, &init_params)?;
            let resp_init = self
                .client
                .get(url_init)
                .header("Accept", "application/json")
                .header("App-Platform", "WebPlayer")
                .send()
                .await?;
            let json_init: TokenResponse = resp_init.json().await?;
            if json_init.access_token.is_none() {
                return Err("Unable to fetch access token after retry".into());
            }
            return Ok(serde_json::to_value(json_init)?);
        }

        Ok(serde_json::to_value(json)?)
    }

    pub async fn get_recommend_song(
        &self,
        token: &str,
        track_id: &str,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("https://spclient.wg.spotify.com/inspiredby-mix/v2/seed_to_playlist/spotify:track:{}?response-format=json", track_id);

        let resp = self
            .client
            .get(&url)
            .header("authorization", format!("Bearer {}", token))
            .send()
            .await?;

        if !resp.status().is_success() {
            let text = resp.text().await?;
            return Err(format!("getRecommendSong failed: {}", text).into());
        }

        let json: serde_json::Value = resp.json().await?;
        Ok(json)
    }
    pub async fn get_lyrics(
        &self,
        token: &str,
        track_id: &str,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("https://spclient.wg.spotify.com/color-lyrics/v2/track/{}?format=json&market=from_token", track_id);
        println!("[WebPlayer] Fetching lyrics from {}", url);

        let resp = self
            .client
            .get(&url)
            .header("authorization", format!("Bearer {}", token))
            .header("app-platform", "WebPlayer")
            .send()
            .await?;

        println!("[WebPlayer] Lyrics response status: {}", resp.status());

        if !resp.status().is_success() {
            // Return Ok(null) or similar if lyrics not found?
            // If 404, it might mean no lyrics.
            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                println!("[WebPlayer] Lyrics not found (404)");
                return Ok(serde_json::json!({ "error": "Lyrics not found", "lyrics": null }));
            }
            let text = resp.text().await?;
            println!("[WebPlayer] Lyrics fetch failed body: {}", text);
            return Err(format!("get_lyrics failed: {}", text).into());
        }

        let json: serde_json::Value = resp.json().await?;
        Ok(json)
    }
}
