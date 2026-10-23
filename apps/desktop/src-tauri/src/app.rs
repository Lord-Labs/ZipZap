use crate::lifecycle;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Manager as _, State};
use tauri_plugin_dialog::DialogExt;
use zipzap_core::{CancellationToken, LinkReplacement, Manager, Settings, Status, Suggestion};

pub(crate) struct AppState {
    first_run: bool,
    pub(crate) manager: Arc<Manager>,
    folder: PathBuf,
    native: Mutex<Option<String>>,
    pub(crate) notice: Mutex<Option<String>>,
    pub(crate) lifecycle: lifecycle::Lifecycle,
    probe: Mutex<Option<(String, CancellationToken)>>,
    browser_review: Mutex<Option<serde_json::Value>>,
    support_preview: Mutex<Option<String>>,
}

#[tauri::command]
fn snapshot(state: State<AppState>) -> serde_json::Value {
    serde_json::json!({"first_run":state.first_run,"jobs":state.manager.jobs(),"queue":state.manager.queue(),"settings":state.manager.settings(),"tray_available":state.lifecycle.available(),"folder":folder(&state),"version":env!("CARGO_PKG_VERSION"),"native_error":*state.native.lock().expect("native lock"),"notice":state.notice.lock().expect("notice lock").take(),"browser_review":state.browser_review.lock().expect("review lock").take()})
}
#[tauri::command]
fn open_extension_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let folder = app
        .path()
        .resource_dir()
        .map_err(|_| "Extension resources unavailable")?
        .join("browser-extension");
    if !folder.join("manifest.json").is_file() {
        return Err("Extension resources unavailable".into());
    }
    app.opener()
        .open_path(folder.to_string_lossy(), None::<&str>)
        .map_err(|_| "Cannot open extension folder".into())
}
#[tauri::command]
fn browser_health(app: tauri::AppHandle) -> serde_json::Value {
    let root = app.path().app_local_data_dir().ok();
    serde_json::json!({
        "chrome":root.as_ref().is_some_and(|root| zipzap_native::health::recent(root, zipzap_native::health::Browser::Chrome)),
        "edge":root.as_ref().is_some_and(|root| zipzap_native::health::recent(root, zipzap_native::health::Browser::Edge))
    })
}
#[tauri::command]
fn preview_support(state: State<AppState>) -> Result<String, String> {
    let mut preview = state.support_preview.lock().expect("support lock");
    *preview = None;
    let available = state.native.lock().expect("native lock").is_none();
    let summary = state.manager.support_summary(Some(available))?;
    *preview = Some(summary.clone());
    Ok(summary)
}

#[tauri::command]
async fn export_support(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<&'static str, String> {
    let preview = state
        .support_preview
        .lock()
        .expect("support lock")
        .clone()
        .ok_or("Preview a support summary first")?;
    tokio::task::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name("zipzap-support.json")
            .add_filter("JSON", &["json"])
            .blocking_save_file()
        else {
            return Ok("cancelled");
        };
        let path = file
            .into_path()
            .map_err(|_| "Choose a local support export file")?;
        crate::support::save(&path, &preview)?;
        Ok("saved")
    })
    .await
    .map_err(|_| "Support export dialog failed".to_owned())?
}
#[tauri::command]
fn set_queue_running(
    running: bool,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    state.manager.set_queue_running(running)?;
    lifecycle::update_menu(&app);
    Ok(())
}
#[tauri::command]
fn move_waiting(id: String, direction: String, state: State<AppState>) -> Result<(), String> {
    state.manager.move_waiting(&id, &direction)
}
#[tauri::command]
fn set_schedule(
    config: Option<zipzap_core::Schedule>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    state.manager.set_schedule(config)?;
    lifecycle::update_menu(&app);
    Ok(())
}
#[tauri::command]
async fn suggest_download(
    id: String,
    url: String,
    destination: String,
    filename: Option<String>,
    automatic_folder: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Suggestion, String> {
    let token = begin_probe(&state, &id)?;
    let result = if automatic_folder.unwrap_or(false) {
        state
            .manager
            .suggest_auto(&url, Path::new(&destination), filename.as_deref(), &token)
            .await
    } else {
        state
            .manager
            .suggest(&url, Path::new(&destination), filename.as_deref(), &token)
            .await
    };
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
    later: bool,
    request_id: Option<String>,
    state: State<AppState>,
) -> Result<String, String> {
    if let Some(id) = request_id {
        let add = if later {
            Manager::add_for_later_with_id
        } else {
            Manager::add_with_id
        };
        return add(
            &state.manager,
            &url,
            Path::new(&destination),
            filename.as_deref(),
            &id,
        )
        .map(|job| job.id);
    }
    let add = if later {
        Manager::add_for_later
    } else {
        Manager::add
    };
    add(
        &state.manager,
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
fn save_settings(
    settings: Settings,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    if settings.close_to_tray
        && !state.manager.settings().close_to_tray
        && !state.lifecycle.available()
    {
        return Err("System tray is unavailable; keep closing behavior set to Quit".into());
    }
    state.manager.set_settings(settings)?;
    lifecycle::update_menu(&app);
    Ok(())
}
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    lifecycle::quit(app);
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
async fn open_download(
    id: String,
    reveal: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
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
        if !zipzap_core::has_internet_zone(&job.destination) {
            let arabic = state.manager.settings().language == "ar";
            let handle = app.clone();
            let confirmed = tokio::task::spawn_blocking(move || {
                let (message, open, cancel) = if arabic {
                    ("تعذّر التحقق من علامة منشأ الإنترنت لهذا الملف. قد لا تتوفر تحذيرات Windows المعتادة. افتحه فقط إذا كنت تثق بالمصدر.", "فتح الملف", "إلغاء")
                } else {
                    ("This file's Internet origin marker could not be verified. Usual Windows warnings may be unavailable. Open it only if you trust its source.", "Open file", "Cancel")
                };
                handle.dialog().message(message).title("ZipZap")
                    .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
                    .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(open.into(), cancel.into()))
                    .blocking_show()
            }).await.map_err(|_| "File warning dialog failed")?;
            if !confirmed {
                return Ok(());
            }
        }
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

async fn enqueue_browser(
    manager: &Manager,
    root: &Path,
    request: &zipzap_native::Inbox,
    fallback: &Path,
    review: &mut Option<serde_json::Value>,
) -> Result<Option<String>, String> {
    use zipzap_native::{Outcome, Rejection};
    if request.version == 2 && zipzap_native::result(root, &request.id)?.is_some() {
        return Ok(None);
    }
    let mut rejection = Rejection::AppRejected;
    let enqueue = async {
        if manager.jobs().iter().any(|job| job.id == request.id) { return Ok(()); }
        let suggestion = manager.suggest_auto(&request.url, fallback, None, &CancellationToken::new()).await?;
        let destination = suggestion.destination.clone();
        if suggestion.alternative.is_some() {
            rejection = Rejection::Destination;
            *review = Some(serde_json::json!({"url":request.url,"destination":destination,"suggestion":suggestion}));
            return Err("Browser destination is occupied; review a new filename".to_owned());
        }
        manager.add_with_id(&request.url, &destination, Some(&suggestion.filename), &request.id)?;
        Ok(())
    }.await;
    if manager.is_stopping() {
        return Err("Browser request retained during shutdown".into());
    }
    if request.version == 2 {
        let outcome = if enqueue.is_ok() {
            Outcome::Queued
        } else {
            Outcome::Rejected { code: rejection }
        };
        // The caller retains the inbox if result persistence fails; job UUIDs make replay safe.
        zipzap_native::save_result(root, &request.id, outcome)?;
    }
    Ok(enqueue.err())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            lifecycle::show(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&root)?;
            let downloads = app.path().download_dir()?;
            std::fs::create_dir_all(&downloads)?;
            let first_run = !root.join("zipzap.sqlite").try_exists()?;
            let manager =
                Manager::open(&root.join("zipzap.sqlite")).map_err(std::io::Error::other)?;
            let native = register(app.handle()).err();
            app.manage(AppState {
                first_run,
                manager: Arc::clone(&manager),
                folder: downloads,
                native: Mutex::new(native),
                notice: Mutex::new(None),
                probe: Mutex::new(None),
                browser_review: Mutex::new(None),
                support_preview: Mutex::new(None),
                lifecycle: lifecycle::Lifecycle::default(),
            });
            if lifecycle::init(app.handle()).is_err() {
                *app.state::<AppState>().notice.lock().expect("notice lock") =
                    Some("System tray unavailable; closing the window will quit ZipZap".into());
            }
            lifecycle::watch(app.handle().clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                manager.start();
                let mut last_heartbeat = std::time::Instant::now() - Duration::from_secs(2);
                loop {
                    if manager.is_stopping() {
                        let _ = std::fs::remove_file(root.join("app-ready.json"));
                        return;
                    }
                    if last_heartbeat.elapsed() >= Duration::from_secs(2) {
                        let _ = zipzap_native::health::heartbeat(&root, env!("CARGO_PKG_VERSION"));
                        last_heartbeat = std::time::Instant::now();
                    }
                    if let Ok(entries) = std::fs::read_dir(root.join("inbox")) {
                        for entry in entries.flatten().take(100) {
                            let path = entry.path();
                            if path.extension().is_none_or(|ext| ext != "json") {
                                continue;
                            }
                            let mut consumed = true;
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
                                if ![1, 2].contains(&request.version)
                                    || !zipzap_native::valid_id(&request.id)
                                    || path.file_stem().and_then(|name| name.to_str())
                                        != Some(&request.id)
                                {
                                    return Err("Unsupported browser request version".into());
                                }
                                let mut review = None;
                                let result = enqueue_browser(
                                    &manager,
                                    &root,
                                    &request,
                                    &folder(&handle.state::<AppState>()),
                                    &mut review,
                                )
                                .await;
                                if let Some(review) = review {
                                    *handle
                                        .state::<AppState>()
                                        .browser_review
                                        .lock()
                                        .expect("review lock") = Some(review);
                                }
                                match result {
                                    Ok(None) => Ok(()),
                                    Ok(Some(notice)) => Err(notice),
                                    Err(error) => {
                                        consumed = false;
                                        Err(error)
                                    }
                                }
                            }
                            .await;
                            // Keep an unconsumed inbox request when shutdown cancels its probe.
                            if manager.is_stopping() {
                                return;
                            }
                            if let Err(error) = outcome {
                                *handle
                                    .state::<AppState>()
                                    .notice
                                    .lock()
                                    .expect("notice lock") = Some(error);
                            }
                            if consumed {
                                let _ = std::fs::remove_file(path);
                            }
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
                if app.state::<AppState>().manager.settings().close_to_tray
                    && app.state::<AppState>().lifecycle.available()
                    && window.hide().is_ok()
                {
                    return;
                }
                lifecycle::quit(app);
            }
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            browser_health,
            open_extension_folder,
            add_download,
            set_queue_running,
            move_waiting,
            set_schedule,
            preview_support,
            export_support,
            suggest_download,
            replace_link,
            cancel_probe,
            download_action,
            save_settings,
            quit_app,
            select_folder,
            open_download,
            connect_browser
        ])
        .build(tauri::generate_context!())
        .expect("ZipZap could not start")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event
                && !app.state::<AppState>().lifecycle.ready_to_exit()
            {
                api.prevent_exit();
                lifecycle::quit(app.clone());
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use zipzap_native::{Inbox, Outcome, Rejection};

    #[test]
    fn browser_result_failure_replay_and_held_queue_use_the_saved_job() {
        tauri::async_runtime::block_on(async {
            let temp = tempfile::tempdir().unwrap();
            let manager = Manager::open(&temp.path().join("state.sqlite")).unwrap();
            manager.set_queue_running(false).unwrap();
            let request = Inbox {
                version: 2,
                id: "2f2d7354-aedf-4f99-8a02-19136fe22cde".into(),
                url: "https://example.com/file?token=private".into(),
            };
            manager
                .add_with_id(&request.url, temp.path(), Some("file.bin"), &request.id)
                .unwrap();
            std::fs::write(temp.path().join("results"), b"block results folder").unwrap();
            assert!(
                enqueue_browser(&manager, temp.path(), &request, temp.path(), &mut None)
                    .await
                    .is_err()
            );
            assert_eq!(manager.jobs().len(), 1);
            std::fs::remove_file(temp.path().join("results")).unwrap();
            assert!(
                enqueue_browser(&manager, temp.path(), &request, temp.path(), &mut None)
                    .await
                    .unwrap()
                    .is_none()
            );
            assert_eq!(
                zipzap_native::result(temp.path(), &request.id)
                    .unwrap()
                    .unwrap()
                    .outcome,
                Outcome::Queued
            );
            assert!(!manager.queue().running);
            assert_eq!(manager.jobs().len(), 1);
            manager.shutdown().await;
            drop(manager);
            let reopened = Manager::open(&temp.path().join("state.sqlite")).unwrap();
            assert!(
                enqueue_browser(&reopened, temp.path(), &request, temp.path(), &mut None)
                    .await
                    .unwrap()
                    .is_none()
            );
            assert_eq!(reopened.jobs().len(), 1);
            reopened.shutdown().await;
        });
    }

    #[test]
    fn browser_collision_persists_a_safe_rejection_without_adding_a_job() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!(
            "http://{}/file.bin?token=private",
            listener.local_addr().unwrap()
        );
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 4096];
            assert!(stream.read(&mut request).unwrap() > 0);
            stream.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 0-0/1\r\nContent-Length: 1\r\nConnection: close\r\n\r\nx").unwrap();
        });
        tauri::async_runtime::block_on(async {
            let temp = tempfile::tempdir().unwrap();
            let manager = Manager::open(&temp.path().join("state.sqlite")).unwrap();
            std::fs::write(temp.path().join("file.bin"), b"existing").unwrap();
            let request = Inbox {
                version: 2,
                id: "792c88f0-fbc7-4dd6-a7b9-02a2277bb0f7".into(),
                url,
            };
            let mut review = None;
            assert!(
                enqueue_browser(&manager, temp.path(), &request, temp.path(), &mut review)
                    .await
                    .unwrap()
                    .is_some()
            );
            assert!(review.is_some());
            assert!(manager.jobs().is_empty());
            assert_eq!(
                std::fs::read(temp.path().join("file.bin")).unwrap(),
                b"existing"
            );
            let result = zipzap_native::result(temp.path(), &request.id)
                .unwrap()
                .unwrap();
            assert_eq!(
                result.outcome,
                Outcome::Rejected {
                    code: Rejection::Destination
                }
            );
            assert!(!serde_json::to_string(&result).unwrap().contains("private"));
            // A replay uses the durable rejection without a second HTTP request.
            assert!(
                enqueue_browser(&manager, temp.path(), &request, temp.path(), &mut None)
                    .await
                    .unwrap()
                    .is_none()
            );
            manager.shutdown().await;
        });
        server.join().unwrap();
    }
}
