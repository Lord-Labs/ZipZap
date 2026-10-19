use crate::app::AppState;
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Manager as _,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_notification::NotificationExt;
use zipzap_core::{Job, Status};

#[derive(Clone)]
struct Tray {
    _icon: TrayIcon,
    show: MenuItem<tauri::Wry>,
    hold: MenuItem<tauri::Wry>,
    start: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

#[derive(Default)]
pub struct Lifecycle {
    tray: Mutex<Option<Tray>>,
    quitting: AtomicBool,
    ready_to_exit: AtomicBool,
}

impl Lifecycle {
    pub fn available(&self) -> bool {
        self.tray.lock().expect("tray lock").is_some()
    }
    pub fn ready_to_exit(&self) -> bool {
        self.ready_to_exit.load(Ordering::Acquire)
    }
}

pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn quit(app: AppHandle) {
    if app
        .state::<AppState>()
        .lifecycle
        .quitting
        .swap(true, Ordering::AcqRel)
    {
        return;
    }
    tauri::async_runtime::spawn(async move {
        app.state::<AppState>().manager.shutdown().await;
        app.state::<AppState>()
            .lifecycle
            .ready_to_exit
            .store(true, Ordering::Release);
        app.exit(0);
    });
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let show_item = MenuItem::with_id(app, "show", "Show ZipZap", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let hold = MenuItem::with_id(app, "hold", "Hold queue", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let start = MenuItem::with_id(app, "start", "Start queue", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit ZipZap", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show_item, &hold, &start, &quit_item])
        .map_err(|e| e.to_string())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("Application icon unavailable")?;
    let icon = TrayIconBuilder::with_id("zipzap-tray")
        .icon(icon)
        .tooltip("ZipZap")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show(app),
            "quit" => quit(app.clone()),
            "hold" | "start" => {
                if let Err(error) = app
                    .state::<AppState>()
                    .manager
                    .set_queue_running(event.id.as_ref() == "start")
                {
                    *app.state::<AppState>().notice.lock().expect("notice lock") = Some(error);
                    show(app);
                }
                update_menu(app);
            }
            _ => {}
        })
        .build(app)
        .map_err(|e| e.to_string())?;
    *app.state::<AppState>()
        .lifecycle
        .tray
        .lock()
        .expect("tray lock") = Some(Tray {
        _icon: icon,
        show: show_item,
        hold,
        start,
        quit: quit_item,
    });
    update_menu(app);
    Ok(())
}

pub fn update_menu(app: &AppHandle) {
    let state = app.state::<AppState>();
    let settings = state.manager.settings();
    let running = state.manager.queue().running;
    let tray = state.lifecycle.tray.lock().expect("tray lock").clone();
    if let Some(tray) = tray {
        let labels = if settings.language == "ar" {
            [
                "إظهار ZipZap",
                "تعليق الطابور",
                "تشغيل الطابور",
                "خروج من ZipZap",
            ]
        } else {
            ["Show ZipZap", "Hold queue", "Start queue", "Quit ZipZap"]
        };
        for (item, label) in [&tray.show, &tray.hold, &tray.start, &tray.quit]
            .into_iter()
            .zip(labels)
        {
            let _ = item.set_text(label);
        }
        let _ = tray.hold.set_enabled(running);
        let _ = tray.start.set_enabled(!running);
    }
}

struct Notices {
    known: HashMap<String, Status>,
    completed: usize,
    failed: usize,
    last: Instant,
}

impl Notices {
    fn new(jobs: &[Job], now: Instant) -> Self {
        Self {
            known: jobs
                .iter()
                .map(|job| (job.id.clone(), job.status.clone()))
                .collect(),
            completed: 0,
            failed: 0,
            last: now,
        }
    }
    fn poll(&mut self, jobs: &[Job], enabled: bool, now: Instant) -> Option<(usize, usize)> {
        for job in jobs {
            if enabled && self.known.get(&job.id) != Some(&job.status) {
                if job.status == Status::Completed {
                    self.completed = self.completed.saturating_add(1);
                }
                if job.status == Status::Failed {
                    self.failed = self.failed.saturating_add(1);
                }
            }
        }
        self.known = jobs
            .iter()
            .map(|job| (job.id.clone(), job.status.clone()))
            .collect();
        if !enabled {
            self.completed = 0;
            self.failed = 0;
            self.last = now;
        }
        if (self.completed > 0 || self.failed > 0)
            && now.duration_since(self.last) >= Duration::from_secs(5)
        {
            let result = (self.completed, self.failed);
            self.completed = 0;
            self.failed = 0;
            self.last = now;
            Some(result)
        } else {
            None
        }
    }
}

pub fn watch(app: AppHandle) {
    let manager = app.state::<AppState>().manager.clone();
    let mut notices = Notices::new(&manager.jobs(), Instant::now());
    tauri::async_runtime::spawn(async move {
        loop {
            if manager.is_stopping() {
                break;
            }
            let settings = manager.settings();
            if let Some((completed, failed)) =
                notices.poll(&manager.jobs(), settings.notifications, Instant::now())
            {
                let body = if settings.language == "ar" {
                    format!(
                        "اكتملت: {completed}. تحتاج مراجعة: {failed}. افتح ZipZap من شريط النظام للتفاصيل."
                    )
                } else {
                    format!(
                        "Completed: {completed}. Need attention: {failed}. Open ZipZap from the tray for details."
                    )
                };
                if app
                    .notification()
                    .builder()
                    .title("ZipZap")
                    .body(body)
                    .show()
                    .is_err()
                {
                    *app.state::<AppState>().notice.lock().expect("notice lock") = Some(
                        "Windows notification could not be prepared; inspect download details"
                            .into(),
                    );
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notices_ignore_history_opt_in_and_restarts_but_batch_new_terminal_transitions() {
        let folder = tempfile::tempdir().unwrap();
        let manager = zipzap_core::Manager::open(&folder.path().join("state.sqlite")).unwrap();
        let mut job = manager
            .add(
                "https://example.com/file?private=SECRET",
                folder.path(),
                None,
            )
            .unwrap();
        job.status = Status::Completed;
        let now = Instant::now();
        let mut notices = Notices::new(&[job.clone()], now);
        assert_eq!(
            notices.poll(&[job.clone()], true, now + Duration::from_secs(10)),
            None
        );
        job.status = Status::Failed;
        assert_eq!(
            notices.poll(&[job.clone()], false, now + Duration::from_secs(11)),
            None
        );
        assert_eq!(
            notices.poll(&[job.clone()], true, now + Duration::from_secs(20)),
            None
        );
        job.status = Status::Downloading;
        assert_eq!(
            notices.poll(&[job.clone()], true, now + Duration::from_secs(21)),
            None
        );
        job.status = Status::Completed;
        assert_eq!(
            notices.poll(&[job.clone()], true, now + Duration::from_secs(22)),
            Some((1, 0))
        );
        assert_eq!(
            notices.poll(&[job.clone()], true, now + Duration::from_secs(23)),
            None
        );
        job.status = Status::Failed;
        assert_eq!(
            notices.poll(&[job.clone()], true, now + Duration::from_secs(24)),
            None
        );
        assert_eq!(
            notices.poll(&[job.clone()], true, now + Duration::from_secs(27)),
            Some((0, 1))
        );
        let mut reopened = Notices::new(&[job.clone()], now);
        assert_eq!(
            reopened.poll(&[job], true, now + Duration::from_secs(30)),
            None
        );
        assert_eq!(notices.poll(&[], true, now + Duration::from_secs(30)), None);
        assert!(notices.known.is_empty());
        let mut completed = manager.jobs()[0].clone();
        completed.status = Status::Completed;
        let mut failed = manager
            .add("https://example.com/other", folder.path(), None)
            .unwrap();
        failed.status = Status::Failed;
        let mut batch = Notices::new(&[], now);
        assert_eq!(
            batch.poll(
                &[completed.clone(), failed.clone()],
                true,
                now + Duration::from_secs(1)
            ),
            None
        );
        assert_eq!(
            batch.poll(
                &[completed.clone(), failed],
                true,
                now + Duration::from_secs(5)
            ),
            Some((1, 1))
        );
        assert_eq!(
            batch.poll(&[completed], true, now + Duration::from_secs(6)),
            None
        );
        assert_eq!(batch.known.len(), 1);
    }
}
