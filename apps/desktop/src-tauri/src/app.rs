use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Manager as _, State};
use tauri_plugin_dialog::DialogExt;
use zipzap_core::{CancellationToken, LinkReplacement, Manager, Settings, Status, Suggestion};

struct AppState {
    manager: Arc<Manager>,
    folder: PathBuf,
    native: Mutex<Option<String>>,
    notice: Mutex<Option<String>>,
    probe: Mutex<Option<(String, CancellationToken)>>,
    browser_review: Mutex<Option<serde_json::Value>>,
}

#[tauri::command]
fn snapshot(state: State<AppState>) -> serde_json::Value {
    serde_json::json!({"jobs":state.manager.jobs(),"settings":state.manager.settings(),"folder":folder(&state),"version":env!("CARGO_PKG_VERSION"),"native_error":*state.native.lock().expect("native lock"),"notice":state.notice.lock().expect("notice lock").take(),"browser_review":state.browser_review.lock().expect("review lock").take()})
}
#[tauri::command]
async fn suggest_download(
    id: String,
    url: String,
    destination: String,
    filename: Option<String>,
    state: State<'_, AppState>,
) -> Result<Suggestion, String> {
    let token = begin_probe(&state, &id)?;
    let result = state
        .manager
        .suggest(&url, Path::new(&destination), filename.as_deref(), &token)
        .await;
    finish_probe(&state, &id);
    result
}
#[tauri::command]
async fn replace_link(
    probe_id: String,
    id: String,
    url: String,
    restart: bool,
    state: State<'_, AppState>,
) -> Result<LinkReplacement, String> {
    let token = begin_probe(&state, &probe_id)?;
    let result = state.manager.replace_link(&id, &url, restart, &token).await;
    finish_probe(&state, &probe_id);
    result
}
fn begin_probe(state: &AppState, id: &str) -> Result<CancellationToken, String> {
    if id.len() > 128 {
        return Err("Invalid probe ID".into());
    }
    let token = CancellationToken::new();
    if let Some((_, previous)) = state
        .probe
        .lock()
        .expect("probe lock")
        .replace((id.to_owned(), token.clone()))
    {
        previous.cancel();
    }
    Ok(token)
}
fn finish_probe(state: &AppState, id: &str) {
    let mut probe = state.probe.lock().expect("probe lock");
    if probe.as_ref().is_some_and(|(current, _)| current == id) {
        probe.take();
    }
}
#[tauri::command]
fn cancel_probe(id: String, state: State<AppState>) {
    let mut probe = state.probe.lock().expect("probe lock");
    if probe.as_ref().is_some_and(|(current, _)| current == &id)
        && let Some((_, token)) = probe.take()
    {
        token.cancel();
    }
}
fn folder(state: &AppState) -> PathBuf {
    state
        .manager
        .settings()
        .download_folder
        .map(PathBuf::from)
        .unwrap_or_else(|| state.folder.clone())
}

#[tauri::command]
fn add_download(
    url: String,
    filename: Option<String>,
    destination: String,
    state: State<AppState>,
) -> Result<String, String> {
    state
        .manager
        .add(
            &url,
            Path::new(&destination),
            filename.as_deref().filter(|v| !v.is_empty()),
        )
        .map(|job| job.id)
}
#[tauri::command]
fn download_action(id: String, action: String, state: State<AppState>) -> Result<(), String> {
    state.manager.action(&id, &action)
}
#[tauri::command]
fn save_settings(settings: Settings, state: State<AppState>) -> Result<(), String> {
    state.manager.set_settings(settings)
}
#[tauri::command]
async fn select_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|_| "Folder dialog failed".into())
}

#[tauri::command]
fn open_download(
    id: String,
    reveal: bool,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let job = state
        .manager
        .jobs()
        .into_iter()
        .find(|j| j.id == id && j.status == Status::Completed)
        .ok_or("Completed download not found")?;
    if reveal {
        app.opener()
            .reveal_item_in_dir(job.destination)
            .map_err(|e| e.to_string())
    } else {
        app.opener()
            .open_path(job.destination.to_string_lossy(), None::<&str>)
            .map_err(|e| e.to_string())
    }
}
#[tauri::command]
fn connect_browser(app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    let result = register(&app);
    *state.native.lock().expect("native lock") = result.as_ref().err().cloned();
    result
}
fn register(app: &tauri::AppHandle) -> Result<(), String> {
    let binary = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name("zipzap-native.exe");
    zipzap_native::register(
        &binary,
        &app.path().app_local_data_dir().map_err(|e| e.to_string())?,
    )
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&root)?;
            let downloads = app.path().download_dir()?;
            std::fs::create_dir_all(&downloads)?;
            let manager =
                Manager::open(&root.join("zipzap.sqlite")).map_err(std::io::Error::other)?;
            let native = register(app.handle()).err();
            app.manage(AppState {
                manager: Arc::clone(&manager),
                folder: downloads,
                native: Mutex::new(native),
                notice: Mutex::new(None),
                probe: Mutex::new(None),
                browser_review: Mutex::new(None),
            });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                manager.start();
                loop {
                    if manager.is_stopping() { return; }
                    if let Ok(entries) = std::fs::read_dir(root.join("inbox")) {
                        for entry in entries.flatten().take(100) {
                            let path = entry.path();
                            if path.extension().is_none_or(|ext| ext != "json") {
                                continue;
                            }
                            let outcome = async {
                                let meta =
                                    std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
                                if !meta.file_type().is_file() || meta.len() > 32768 {
                                    return Err("Invalid browser request file".into());
                                }
                                let request: zipzap_native::Inbox = serde_json::from_slice(
                                    &std::fs::read(&path).map_err(|e| e.to_string())?,
                                )
                                .map_err(|_| "Invalid browser request")?;
                                if request.version != 1 {
                                    return Err("Unsupported browser request version".into());
                                }
                                if manager.jobs().iter().any(|job| job.id == request.id) {
                                    return Ok(());
                                }
                                let destination = folder(&handle.state::<AppState>());
                                let suggestion = manager.suggest(&request.url, &destination, None, &CancellationToken::new()).await?;
                                if suggestion.alternative.is_some() {
                                    *handle.state::<AppState>().browser_review.lock().expect("review lock") = Some(serde_json::json!({"url":request.url,"destination":destination,"suggestion":suggestion}));
                                    return Err("Browser destination is occupied; review a new filename".to_owned());
                                }
                                manager.add_with_id(
                                    &request.url,
                                    &destination,
                                    Some(&suggestion.filename),
                                    &request.id,
                                )?;
                                Ok(())
                            }.await;
                            // Keep an unconsumed inbox request when shutdown cancels its probe.
                            if manager.is_stopping() { return; }
                            if let Err(error) = outcome {
                                *handle
                                    .state::<AppState>()
                                    .notice
                                    .lock()
                                    .expect("notice lock") = Some(error);
                            }
                            let _ = std::fs::remove_file(path);
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    app.state::<AppState>().manager.shutdown().await;
                    app.exit(0);
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            add_download,
            suggest_download,
            replace_link,
            cancel_probe,
            download_action,
            save_settings,
            select_folder,
            open_download,
            connect_browser
        ])
        .run(tauri::generate_context!())
        .expect("ZipZap could not start");
}
