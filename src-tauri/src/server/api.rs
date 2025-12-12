use crate::server::spotify_web_player::SpotifyWebPlayer;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use warp::Filter;

#[derive(Clone)]
struct ServerState {
    pending_auth_states: Arc<Mutex<HashMap<String, PendingAuth>>>,
    web_player: Arc<SpotifyWebPlayer>,
    backend_token_cache: Arc<Mutex<BackendTokenCache>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PendingAuth {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
}

#[derive(Clone, Debug)]
struct BackendTokenCache {
    token: Option<String>,
    expires_at: Option<i64>,
}

pub async fn start_server() {
    let pending_auth_states = Arc::new(Mutex::new(HashMap::new()));

    let sp_dc = env::var("SP_DC").unwrap_or_else(|_| {
        eprintln!("WARNING: SP_DC environment variable not set. Lyrics and Web Player features will fail!");
        "".to_string()
    });

    let web_player = Arc::new(SpotifyWebPlayer::new(sp_dc));
    // Init secrets in background
    let wp_clone = web_player.clone();
    tokio::spawn(async move {
        if let Err(e) = wp_clone.init_secrets().await {
            eprintln!("Failed to init secrets: {}", e);
        }
    });

    let state = ServerState {
        pending_auth_states,
        web_player,
        backend_token_cache: Arc::new(Mutex::new(BackendTokenCache {
            token: None,
            expires_at: None,
        })),
    };

    let state_filter = warp::any().map(move || state.clone());

    let cors = warp::cors()
        .allow_any_origin()
        .allow_headers(vec![
            "Origin",
            "X-Requested-With",
            "Content-Type",
            "Accept",
            "Authorization",
        ])
        .allow_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS"]);

    // Routes
    let route_login = warp::path("login")
        .and(warp::query::<HashMap<String, String>>())
        .and(warp::any().map(load_env_config))
        .map(|params: HashMap<String, String>, config: EnvConfig| {
            let state = params.get("state").cloned().unwrap_or_default();
            let scopes = "ugc-image-upload user-read-playback-state user-modify-playback-state user-read-currently-playing streaming app-remote-control user-read-email user-read-private playlist-read-collaborative playlist-modify-public playlist-read-private playlist-modify-private user-library-modify user-library-read user-top-read user-read-playback-position user-read-recently-played user-follow-read user-follow-modify";
            let auth_url = format!(
                "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}&state={}",
                config.client_id, config.redirect_uri, urlencoding::encode(scopes), state
            );
            warp::redirect(warp::http::Uri::from_maybe_shared(auth_url).unwrap())
        });

    let route_callback = warp::path("callback")
        .and(warp::query::<HashMap<String, String>>())
        .and(state_filter.clone())
        .and(warp::any().map(load_env_config))
        .and_then(handle_callback);

    let route_auth_check = warp::path("auth-check")
        .and(warp::query::<HashMap<String, String>>())
        .and(state_filter.clone())
        .map(|params: HashMap<String, String>, state: ServerState| {
            let pending_param = params.get("state").map(|s| s.to_string());
            if let Some(s) = pending_param {
                let mut map = state.pending_auth_states.lock().unwrap();
                if let Some(auth) = map.remove(&s) {
                    return warp::reply::json(&auth);
                }
            }
            warp::reply::json(&serde_json::json!({ "pending": true }))
        });

    let route_refresh = warp::path("refresh_token")
        .and(warp::query::<HashMap<String, String>>())
        .and(warp::any().map(load_env_config))
        .and_then(handle_refresh);

    let route_recommendation = warp::path("recommendation")
        .and(warp::post())
        .and(warp::body::json())
        .and(state_filter.clone())
        .and_then(handle_recommendation);

    // Proxy routes - removed unused placeholder

    // We need to implement the specific proxy endpoints manually as in Express
    let route_me_playlists = warp::path!("me" / "playlists")
        .and(warp::header::optional::<String>("authorization"))
        .and_then(handle_me_playlists);

    let route_playlist_tracks = warp::path!("playlists" / String / "tracks")
        .and(warp::header::optional::<String>("authorization"))
        .and_then(handle_playlist_tracks);

    let route_search = warp::path("search")
        .and(warp::query::<HashMap<String, String>>())
        .and(warp::header::optional::<String>("authorization"))
        .and_then(handle_search);

    let route_check_saved = warp::path!("me" / "tracks" / "contains")
        .and(warp::query::<HashMap<String, String>>())
        .and(warp::header::optional::<String>("authorization"))
        .and_then(handle_check_saved);

    let route_save_tracks = warp::path!("me" / "tracks")
        .and(warp::put())
        .and(warp::body::json())
        .and(warp::header::optional::<String>("authorization"))
        .and_then(handle_save_tracks);

    let route_remove_tracks = warp::path!("me" / "tracks")
        .and(warp::delete())
        .and(warp::body::json())
        .and(warp::header::optional::<String>("authorization"))
        .and_then(handle_remove_tracks);

    let route_lyrics = warp::path!("lyrics" / String)
        .and(state_filter.clone())
        .and_then(handle_lyrics);

    let routes = route_login
        .or(route_callback)
        .or(route_auth_check)
        .or(route_refresh)
        .or(route_recommendation)
        .or(route_me_playlists)
        .or(route_playlist_tracks)
        .or(route_search)
        .or(route_check_saved)
        .or(route_save_tracks)
        .or(route_remove_tracks)
        .or(route_lyrics) // Add lyrics route
        .or(warp::fs::dir("../ui"))
        .with(cors);

    println!("Starting Rust backend on port 8888...");
    warp::serve(routes).run(([127, 0, 0, 1], 8888)).await;
}

#[derive(Clone)]
struct EnvConfig {
    client_id: String,
    client_secret: String,
    redirect_uri: String,
}

fn load_env_config() -> EnvConfig {
    // In production we might not have .env file, so better to bake them in or read from env.
    // For now assuming env vars are set or .env is present (dotenv called in main)
    EnvConfig {
        client_id: env::var("CLIENT_ID").unwrap_or_default(),
        client_secret: env::var("CLIENT_SECRET").unwrap_or_default(),
        redirect_uri: env::var("REDIRECT_URI")
            .unwrap_or_else(|_| "http://localhost:8888/callback".to_string()),
    }
}

async fn handle_callback(
    params: HashMap<String, String>,
    state: ServerState,
    config: EnvConfig,
) -> Result<impl warp::Reply, warp::Rejection> {
    if let Some(err) = params.get("error") {
        return Ok(warp::reply::html(format!("Callback Error: {}", err)));
    }

    let code = params.get("code").map(|s| s.as_str()).unwrap_or("");
    let auth_state = params.get("state").map(|s| s.as_str()).unwrap_or("");

    let client = reqwest::Client::new();
    let res = client
        .post("https://accounts.spotify.com/api/token")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &config.redirect_uri),
            ("client_id", &config.client_id),
            ("client_secret", &config.client_secret),
        ])
        .send()
        .await;

    match res {
        Ok(resp) => {
            if resp.status().is_success() {
                let json: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
                // Extract tokens
                let access_token = json["access_token"].as_str().unwrap_or("").to_string();
                let refresh_token = json["refresh_token"].as_str().unwrap_or("").to_string();
                let expires_in = json["expires_in"].as_i64().unwrap_or(0);

                if !auth_state.is_empty() {
                    let mut map = state.pending_auth_states.lock().unwrap();
                    map.insert(
                        auth_state.to_string(),
                        PendingAuth {
                            access_token,
                            refresh_token,
                            expires_in,
                        },
                    );
                }

                Ok(warp::reply::html(r#"
                    <html>
                        <body style="background-color: #1a1a1a; color: #1DB954; font-family: monospace; display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center;">
                        <div>
                            <h1>Login Successful!</h1>
                            <p>You can close this window and return to the app.</p>
                            <script>window.close();</script>
                        </div>
                        </body>
                    </html>
                "#.to_string()))
            } else {
                let err_text = resp.text().await.unwrap_or_default();
                Ok(warp::reply::html(format!(
                    "Error getting tokens: {}",
                    err_text
                )))
            }
        }
        Err(e) => Ok(warp::reply::html(format!("Error getting tokens: {}", e))),
    }
}

async fn handle_refresh(
    params: HashMap<String, String>,
    config: EnvConfig,
) -> Result<impl warp::Reply, warp::Rejection> {
    let refresh_token = match params.get("refresh_token") {
        Some(t) => t,
        None => {
            return Ok(warp::reply::with_status(
                warp::reply::json(&serde_json::json!({"error": "Missing refresh_token"})),
                warp::http::StatusCode::BAD_REQUEST,
            ))
        }
    };

    let client = reqwest::Client::new();
    let res = client
        .post("https://accounts.spotify.com/api/token")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", &config.client_id),
            ("client_secret", &config.client_secret),
        ])
        .send()
        .await;

    match res {
        Ok(resp) => {
            if resp.status().is_success() {
                let json: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
                Ok(warp::reply::with_status(
                    warp::reply::json(&json),
                    warp::http::StatusCode::OK,
                ))
            } else {
                Ok(warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"error": "Failed to refresh"})),
                    warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                ))
            }
        }
        Err(_) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Failed to refresh"})),
            warp::http::StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

// Helper for proxy calls
async fn create_spotify_client(token: &str) -> reqwest::Client {
    // JS used spotify-web-api-node which is just a wrapper. We can make raw requests.
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .unwrap()
}

async fn handle_me_playlists(
    auth_header: Option<String>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let token = match extract_token(auth_header) {
        Some(t) => t,
        None => {
            return Ok(warp::reply::with_status(
                warp::reply::json(&"Missing token"),
                warp::http::StatusCode::UNAUTHORIZED,
            ))
        }
    };

    let client = create_spotify_client(&token).await;
    // Get Me then Get Playlists? JS did that.
    // Actually we can just get current user playlists
    let res = client
        .get("https://api.spotify.com/v1/me/playlists?limit=50")
        .send()
        .await; // limit default in JS wrapper?

    match res {
        Ok(resp) => {
            let json: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
            // JS returned playlists.body.items
            let items = json.get("items").unwrap_or(&serde_json::Value::Null);
            Ok(warp::reply::with_status(
                warp::reply::json(items),
                warp::http::StatusCode::OK,
            ))
        }
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&format!("Error: {}", e)),
            warp::http::StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

// Mapper function to match JS output structure
fn map_track(item: &serde_json::Value) -> Option<serde_json::Value> {
    let track = item.get("track")?;
    if track.is_null() {
        return None;
    }

    Some(serde_json::json!({
        "id": track["id"],
        "uri": track["uri"],
        "name": track["name"],
        "duration_ms": track["duration_ms"],
        "album": {
            "id": track["album"]["id"],
            "name": track["album"]["name"],
            "images": track["album"]["images"]
        },
        "artists": track["artists"].as_array().unwrap_or(&vec![]).iter().map(|a| {
            serde_json::json!({
                "id": a["id"],
                "name": a["name"]
            })
        }).collect::<Vec<_>>()
    }))
}

async fn handle_playlist_tracks(
    playlist_id: String,
    auth_header: Option<String>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let token = match extract_token(auth_header) {
        Some(t) => t,
        None => {
            return Ok(warp::reply::with_status(
                warp::reply::json(&"Missing token"),
                warp::http::StatusCode::UNAUTHORIZED,
            ))
        }
    };

    let client = create_spotify_client(&token).await;
    let res = client
        .get(format!(
            "https://api.spotify.com/v1/playlists/{}/tracks?limit=100",
            playlist_id
        ))
        .send()
        .await;

    match res {
        Ok(resp) => {
            let status = resp.status();
            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                println!(
                    "[API] Playlist fetch failed. Status: {}, Body: {}",
                    status, text
                );
                return Ok(warp::reply::with_status(
                    warp::reply::json(&format!("Spotify API Error: {}", text)),
                    warp::http::StatusCode::BAD_GATEWAY,
                ));
            }

            let json: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
            // Map tracks
            let items = json.get("items").and_then(|i| i.as_array());
            let mapped: Vec<serde_json::Value> = match items {
                Some(arr) => arr.iter().filter_map(map_track).collect(),
                None => vec![],
            };

            Ok(warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "tracks": mapped })),
                warp::http::StatusCode::OK,
            ))
        }
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&format!("Error: {}", e)),
            warp::http::StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

async fn handle_search(
    params: HashMap<String, String>,
    auth_header: Option<String>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let token = match extract_token(auth_header) {
        Some(t) => t,
        None => {
            return Ok(warp::reply::with_status(
                warp::reply::json(&"Missing token"),
                warp::http::StatusCode::UNAUTHORIZED,
            ))
        }
    };

    let query = params.get("q").cloned().unwrap_or_default();
    if query.is_empty() {
        return Ok(warp::reply::with_status(
            warp::reply::json(&"Missing q"),
            warp::http::StatusCode::BAD_REQUEST,
        ));
    }

    let client = create_spotify_client(&token).await;
    let res = client
        .get("https://api.spotify.com/v1/search")
        .query(&[
            ("q", query),
            ("type", "track".to_string()),
            ("limit", "15".to_string()),
        ])
        .send()
        .await;

    match res {
        Ok(resp) => {
            let json: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
            // JS: result.body.tracks.items.map(mapTrack)
            // But search result structure is different from playlist item.
            // Search result items are tracks directly, not wrapped in {track: ...}
            // Wait, the mapTrack function in JS handles track object.
            // In search, items ARE tracks.
            // Does mapTrack handle direct track or wrapped?
            // JS: const tracks = result.body.tracks?.items ? result.body.tracks.items.map(mapTrack) ...
            // JS mapTrack takes `track`.
            // In playlist response: item.track is passed.
            // In search response: it is a list of tracks.
            // BUT mapTrack implementation checks track.id, track.album etc.
            // So if we pass the track object itself it works.

            let items = json
                .get("tracks")
                .and_then(|t| t.get("items"))
                .and_then(|i| i.as_array());

            // We need a slight variation of map_track for search results because they don't have the wrapper?
            // No, wait.
            // In JS: `mapTrack(track)`
            // Playlist item: `{ added_at: ..., track: { id: ... } }` -> pass `item.track`
            // Search item: `{ id: ... }` -> pass `item`
            // My `map_track` function expects `{ track: { ... } }` wrapper?
            // Yes: `let track = item.get("track")?;`
            // So I need a direct mapper.

            let mapped: Vec<serde_json::Value> = match items {
                 Some(arr) => arr.iter().map(|track| {
                     serde_json::json!({
                        "id": track["id"],
                        "uri": track["uri"],
                        "name": track["name"],
                        "duration_ms": track["duration_ms"],
                        "album": {
                            "id": track["album"]["id"],
                            "name": track["album"]["name"],
                            "images": track["album"]["images"]
                        },
                        "artists": track["artists"].as_array().unwrap_or(&vec![]).iter().map(|a| {
                            serde_json::json!({
                                "id": a["id"],
                                "name": a["name"]
                            })
                        }).collect::<Vec<_>>()
                     })
                 }).collect(),
                 None => vec![]
             };

            Ok(warp::reply::with_status(
                warp::reply::json(&mapped),
                warp::http::StatusCode::OK,
            ))
        }
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&format!("Error: {}", e)),
            warp::http::StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

async fn handle_check_saved(
    params: HashMap<String, String>,
    auth_header: Option<String>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let token = match extract_token(auth_header) {
        Some(t) => t,
        None => {
            return Ok(warp::reply::with_status(
                warp::reply::json(&"Missing token"),
                warp::http::StatusCode::UNAUTHORIZED,
            ))
        }
    };

    let ids = params.get("ids").cloned().unwrap_or_default();
    if ids.is_empty() {
        return Ok(warp::reply::with_status(
            warp::reply::json(&"Missing ids"),
            warp::http::StatusCode::BAD_REQUEST,
        ));
    }

    let client = create_spotify_client(&token).await;
    let res = client
        .get("https://api.spotify.com/v1/me/tracks/contains")
        .query(&[("ids", ids)])
        .send()
        .await;

    match res {
        Ok(resp) => {
            let json: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
            Ok(warp::reply::with_status(
                warp::reply::json(&json),
                warp::http::StatusCode::OK,
            ))
        }
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&format!("Error: {}", e)),
            warp::http::StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

#[derive(Deserialize)]
struct IdsBody {
    ids: Vec<String>,
}

async fn handle_save_tracks(
    body: IdsBody,
    auth_header: Option<String>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let token = match extract_token(auth_header) {
        Some(t) => t,
        None => {
            return Ok(warp::reply::with_status(
                warp::reply::json(&"Missing token"),
                warp::http::StatusCode::UNAUTHORIZED,
            ))
        }
    };

    let client = create_spotify_client(&token).await;
    // For PUT /me/tracks, body is array of ids?
    // JS: await tempApi.addToMySavedTracks(ids);
    // SDK sends JSON body: { ids: [...] } or just query?
    // Start with JSON body as SDK usually does.

    let res = client
        .put("https://api.spotify.com/v1/me/tracks")
        .json(&serde_json::json!({ "ids": body.ids }))
        .send()
        .await;

    match res {
        Ok(resp) => {
            if resp.status().is_success() {
                Ok(warp::reply::with_status(
                    warp::reply::json(&"OK"),
                    warp::http::StatusCode::OK,
                ))
            } else {
                Ok(warp::reply::with_status(
                    warp::reply::json(&"Failed"),
                    warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                ))
            }
        }
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&format!("Error: {}", e)),
            warp::http::StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

async fn handle_remove_tracks(
    body: IdsBody,
    auth_header: Option<String>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let token = match extract_token(auth_header) {
        Some(t) => t,
        None => {
            return Ok(warp::reply::with_status(
                warp::reply::json(&"Missing token"),
                warp::http::StatusCode::UNAUTHORIZED,
            ))
        }
    };

    let client = create_spotify_client(&token).await;

    // DELETE with body is tricky in some clients, but reqwest supports it.
    let res = client
        .delete("https://api.spotify.com/v1/me/tracks")
        .json(&serde_json::json!({ "ids": body.ids }))
        .send()
        .await;

    match res {
        Ok(resp) => {
            if resp.status().is_success() {
                Ok(warp::reply::with_status(
                    warp::reply::json(&"OK"),
                    warp::http::StatusCode::OK,
                ))
            } else {
                Ok(warp::reply::with_status(
                    warp::reply::json(&"Failed"),
                    warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                ))
            }
        }
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&format!("Error: {}", e)),
            warp::http::StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

async fn handle_recommendation(
    body: serde_json::Value,
    state: ServerState,
) -> Result<impl warp::Reply, warp::Rejection> {
    let track_id = match body.get("trackId").and_then(|t| t.as_str()) {
        Some(id) => id,
        None => {
            return Ok(warp::reply::with_status(
                warp::reply::json(&serde_json::json!({"error": "Missing trackId"})),
                warp::http::StatusCode::BAD_REQUEST,
            ))
        }
    };

    // Get backend token logic
    let token_res = get_backend_token(&state).await;
    let token = match token_res {
        Ok(t) => t,
        Err(e) => {
            return Ok(warp::reply::with_status(
                warp::reply::json(
                    &serde_json::json!({"error": format!("Failed to get backend token: {}", e)}),
                ),
                warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            ))
        }
    };

    let rec_res = state.web_player.get_recommend_song(&token, track_id).await;
    match rec_res {
        Ok(payload) => {
            // Extract playlist id
            let media_item = payload
                .get("mediaItems")
                .and_then(|a| a.as_array())
                .and_then(|a| a.first());
            let uri = media_item
                .and_then(|m| m.get("uri"))
                .and_then(|u| u.as_str());

            let (playlist_uri, playlist_id) = if let Some(u) = uri {
                let parts: Vec<&str> = u.split(':').collect();
                (u.to_string(), parts.last().unwrap_or(&"").to_string())
            } else {
                ("".to_string(), "".to_string())
            };

            if playlist_id.is_empty() {
                return Ok(warp::reply::with_status(
                    warp::reply::json(
                        &serde_json::json!({"error": "Recommendation missing playlist data"}),
                    ),
                    warp::http::StatusCode::BAD_GATEWAY,
                ));
            }

            Ok(warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "playlistUri": playlist_uri,
                    "playlistId": playlist_id,
                    "raw": payload
                })),
                warp::http::StatusCode::OK,
            ))
        }
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": format!("Failed: {}", e)})),
            warp::http::StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

async fn handle_lyrics(
    track_id: String,
    state: ServerState,
) -> Result<impl warp::Reply, warp::Rejection> {
    println!("[API] handle_lyrics called for track_id: {}", track_id);

    // Get backend token logic
    let token_res = get_backend_token(&state).await;
    let token = match token_res {
        Ok(t) => {
            println!("[API] Got backend token successfully");
            t
        }
        Err(e) => {
            println!("[API] Failed to get backend token: {}", e);
            return Ok(warp::reply::with_status(
                warp::reply::json(
                    &serde_json::json!({"error": format!("Failed to get backend token: {}", e)}),
                ),
                warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            ));
        }
    };

    let lyrics_res = state.web_player.get_lyrics(&token, &track_id).await;
    match lyrics_res {
        Ok(payload) => {
            println!("[API] Lyrics fetched successfully");
            Ok(warp::reply::with_status(
                warp::reply::json(&payload),
                warp::http::StatusCode::OK,
            ))
        }
        Err(e) => {
            println!("[API] Failed to fetch lyrics: {}", e);
            Ok(warp::reply::with_status(
                warp::reply::json(&serde_json::json!({"error": format!("Failed: {}", e)})),
                warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            ))
        }
    }
}

async fn get_backend_token(
    state: &ServerState,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64;
    {
        let cache = state.backend_token_cache.lock().unwrap();

        if let (Some(token), Some(expires_at)) = (&cache.token, cache.expires_at) {
            if expires_at - 60 > now {
                return Ok(token.clone());
            }
        }
    }

    // Refresh (lock is dropped above)

    let token_data = state.web_player.get_access_token().await?;
    let token = token_data
        .get("accessToken")
        .and_then(|s| s.as_str())
        .ok_or("No access token")?
        .to_string();
    let expires_in_ms = token_data
        .get("accessTokenExpirationTimestampMs")
        .and_then(|t| t.as_i64())
        .unwrap_or(0);
    // accessTokenExpirationTimestampMs is usually absolute timestamp in ms?
    // JS: expiresAt = tokenData.data?.accessTokenExpirationTimestampMs ? Math.floor(... / 1000) : null;
    let expires_at = if expires_in_ms > 0 {
        expires_in_ms / 1000
    } else {
        now + 1800
    };

    let mut cache = state.backend_token_cache.lock().unwrap();
    cache.token = Some(token.clone());
    cache.expires_at = Some(expires_at);

    Ok(token)
}

fn extract_token(auth_header: Option<String>) -> Option<String> {
    auth_header.and_then(|h| {
        let parts: Vec<&str> = h.split(' ').collect();
        if parts.len() == 2 && parts[0] == "Bearer" {
            Some(parts[1].to_string())
        } else {
            None
        }
    })
}
