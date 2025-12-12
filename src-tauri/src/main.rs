// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod server;

use dotenv::dotenv;

fn main() {
    dotenv().ok(); // Load .env if present

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            // Spawn the Rust server in a background task
            tauri::async_runtime::spawn(async {
                server::api::start_server().await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
