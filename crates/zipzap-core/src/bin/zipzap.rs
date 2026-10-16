//! Headless JSON-lines interface, also used by deterministic integration fixtures.
use serde_json::{Value, json};
use std::{
    io::{self, BufRead, Write},
    path::Path,
};
use zipzap_core::Manager;

#[tokio::main]
async fn main() {
    let Some(database) = std::env::args().nth(1) else {
        eprintln!("usage: zipzap <state.sqlite>");
        std::process::exit(2);
    };
    let certificate = std::env::args()
        .nth(2)
        .map(|path| {
            std::fs::read(path)
                .map_err(|e| e.to_string())
                .and_then(|bytes| reqwest::Certificate::from_pem(&bytes).map_err(|e| e.to_string()))
        })
        .transpose()
        .expect("valid explicit CA certificate");
    let manager = match Manager::open_with_ca(Path::new(&database), certificate) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    manager.start();
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else {
            break;
        };
        if line.len() > 32768 {
            println!("{{\"error\":\"Message too large\"}}");
            continue;
        }
        let result = match serde_json::from_str::<Value>(&line) {
            Ok(value) => dispatch(&manager, &value),
            Err(_) => Err("Invalid JSON command".into()),
        };
        println!(
            "{}",
            match result {
                Ok(v) => json!({"result":v}),
                Err(e) => json!({"error":e}),
            }
        );
        let _ = io::stdout().flush();
        if serde_json::from_str::<Value>(&line)
            .ok()
            .and_then(|v| v["command"].as_str().map(str::to_owned))
            .as_deref()
            == Some("shutdown")
        {
            break;
        }
    }
    manager.shutdown().await;
}

fn dispatch(manager: &Manager, value: &Value) -> Result<Value, String> {
    match value["command"].as_str().unwrap_or("") {
        "add" => manager
            .add(
                value["url"].as_str().ok_or("Missing URL")?,
                Path::new(value["folder"].as_str().ok_or("Missing folder")?),
                value["filename"].as_str(),
            )
            .and_then(|j| serde_json::to_value(j).map_err(|_| "Serialization failed".into())),
        "jobs" => Ok(json!(manager.jobs())),
        "settings" => {
            if let Some(settings) = value.get("value") {
                manager.set_settings(
                    serde_json::from_value(settings.clone()).map_err(|_| "Invalid settings")?,
                )?;
            }
            Ok(json!(manager.settings()))
        }
        "action" => {
            manager.action(
                value["id"].as_str().ok_or("Missing ID")?,
                value["action"].as_str().ok_or("Missing action")?,
            )?;
            Ok(json!(true))
        }
        "shutdown" => Ok(json!(true)),
        _ => Err("Unknown command".into()),
    }
}
