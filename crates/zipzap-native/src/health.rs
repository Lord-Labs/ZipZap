use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Browser {
    Chrome,
    Edge,
}

impl Browser {
    fn file(self) -> &'static str {
        match self {
            Self::Chrome => "contact-chrome.json",
            Self::Edge => "contact-edge.json",
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Contact {
    at: u64,
    session: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AppReady {
    at: u64,
    version: String,
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn fresh(at: u64, now: u64, seconds: u64) -> bool {
    now.checked_sub(at).is_some_and(|age| age < seconds)
}

fn save(state: &Path, name: &str, value: &impl Serialize) -> Result<(), String> {
    use std::io::Write;
    std::fs::create_dir_all(state).map_err(|_| "Cannot create local health state")?;
    let temporary = state.join(format!("health-{}.tmp", uuid::Uuid::new_v4()));
    let written = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&serde_json::to_vec(value)?)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, state.join(name))
    })();
    let _ = std::fs::remove_file(temporary);
    written.map_err(|_: std::io::Error| "Cannot save local health state".into())
}

pub fn heartbeat(state: &Path, version: &str) -> Result<(), String> {
    save(
        state,
        "app-ready.json",
        &AppReady {
            at: now(),
            version: version.to_owned(),
        },
    )
}

pub fn recent(state: &Path, browser: Browser) -> bool {
    crate::read_local(&state.join(browser.file()))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Contact>(&bytes).ok())
        .is_some_and(|contact| crate::valid_id(&contact.session) && fresh(contact.at, now(), 300))
}

pub(crate) fn answer(
    state: &Path,
    browser: Browser,
    session: &str,
) -> Result<serde_json::Value, String> {
    let time = now();
    save(
        state,
        browser.file(),
        &Contact {
            at: time,
            session: session.to_owned(),
        },
    )?;
    let app = crate::read_local(&state.join("app-ready.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<AppReady>(&bytes).ok())
        .filter(|app| fresh(app.at, time, 5) && app.version.len() < 40);
    Ok(
        serde_json::json!({"version":2,"id":session,"state":"health",
        "host_version":env!("CARGO_PKG_VERSION"),"app_ready":app.is_some(),
        "app_version":app.map(|app| app.version),"capabilities":["explicit"]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn health_is_fresh_bounded_and_does_not_claim_all_profiles() {
        let temp = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(
            answer(temp.path(), Browser::Chrome, &id).unwrap()["app_ready"],
            false
        );
        assert!(recent(temp.path(), Browser::Chrome));
        assert!(!recent(temp.path(), Browser::Edge));
        heartbeat(temp.path(), "test").unwrap();
        assert_eq!(
            answer(temp.path(), Browser::Chrome, &id).unwrap()["app_version"],
            "test"
        );
        save(
            temp.path(),
            "app-ready.json",
            &AppReady {
                at: now().saturating_sub(6),
                version: "test".into(),
            },
        )
        .unwrap();
        assert_eq!(
            answer(temp.path(), Browser::Chrome, &id).unwrap()["app_ready"],
            false
        );
        save(
            temp.path(),
            Browser::Chrome.file(),
            &Contact {
                at: now() + 60,
                session: id,
            },
        )
        .unwrap();
        assert!(!recent(temp.path(), Browser::Chrome));
        assert!(!temp.path().join("inbox").exists());
        assert!(!temp.path().join("results").exists());
    }
}
