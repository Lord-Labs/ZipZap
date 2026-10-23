use serde::{Deserialize, Serialize};
pub mod capture;
pub mod health;
pub mod video;
use std::{
    io::{Read, Write},
    path::Path,
};

pub const APP_ID: &str = "com.zipzap.desktop";
pub const HOST: &str = "com.zipzap.native";
pub fn extension_id() -> String {
    serde_json::from_str::<serde_json::Value>(include_str!(
        "../../../extensions/browser/identity.json"
    ))
    .expect("bundled identity")["id"]
        .as_str()
        .expect("identity ID")
        .to_owned()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    pub url: Option<String>,
    pub id: Option<String>,
    pub action: Option<String>,
    pub browser: Option<health::Browser>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Inbox {
    pub version: u32,
    pub id: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
}

impl Inbox {
    pub fn stem(&self) -> Result<String, String> {
        if !valid_id(&self.id) {
            return Err("Invalid request ID".into());
        }
        match (self.version, self.action.as_deref(), self.created_at) {
            (1 | 2, None, None) => Ok(self.id.clone()),
            (3, Some(action @ ("prepare" | "prepare_video")), Some(_)) if !self.url.is_empty() => {
                Ok(format!("{}-{action}", self.id))
            }
            (3, Some(action @ ("activate" | "cancel_prepare")), Some(_)) if self.url.is_empty() => {
                Ok(format!("{}-{action}", self.id))
            }
            _ => Err("Unsupported browser operation".into()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum Outcome {
    Received,
    Prepared,
    Queued,
    Rejected { code: Rejection },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Rejection {
    InboxFull,
    HostRejected,
    Destination,
    AppRejected,
    AppStartFailed,
    Expired,
    CaptureExpired,
    VideoUnavailable,
    CaptureCancelled,
}

#[derive(Serialize, Deserialize)]
pub struct Receipt {
    pub version: u32,
    pub id: String,
    #[serde(flatten)]
    pub outcome: Outcome,
}

pub fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id)
}

fn receipt(version: u32, id: &str, outcome: Outcome) -> serde_json::Value {
    serde_json::to_value(Receipt {
        version,
        id: id.to_owned(),
        outcome,
    })
    .expect("serializable receipt")
}

fn read_local(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| "Local message unavailable")?;
    if !metadata.file_type().is_file() || metadata.len() > 32768 {
        return Err("Invalid local message".into());
    }
    std::fs::read(path).map_err(|_| "Local message unavailable".into())
}

pub(crate) fn write_local(state: &Path, name: &str, value: &impl Serialize) -> Result<(), String> {
    use std::io::Write;
    let bytes = serde_json::to_vec(value).map_err(|_| "Cannot encode local record")?;
    if bytes.len() > 32768 {
        return Err("Local record size rejected".into());
    }
    std::fs::create_dir_all(state).map_err(|_| "Cannot create local record folder")?;
    let temporary = state.join(format!("record-{}.tmp", uuid::Uuid::new_v4()));
    let written = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, state.join(name))
    })();
    let _ = std::fs::remove_file(temporary);
    written.map_err(|_: std::io::Error| "Cannot save local record".into())
}

// Results are private local acknowledgments, never a log of links or raw errors.
pub fn result(state: &Path, id: &str) -> Result<Option<Receipt>, String> {
    if !valid_id(id) {
        return Err("Invalid request ID".into());
    }
    let path = state.join("results").join(format!("{id}.json"));
    if !path
        .try_exists()
        .map_err(|_| "Cannot inspect local result")?
    {
        return Ok(None);
    }
    let age = std::fs::symlink_metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|time| time.elapsed().ok())
        .unwrap_or_default();
    if age.as_secs() >= 86400 {
        return Ok(None);
    }
    let saved: Receipt =
        serde_json::from_slice(&read_local(&path)?).map_err(|_| "Invalid local result")?;
    if saved.id != id
        || ![2, 3].contains(&saved.version)
        || saved.outcome == Outcome::Received
        || (saved.version == 2 && saved.outcome == Outcome::Prepared)
    {
        return Err("Invalid local result".into());
    }
    Ok(Some(saved))
}

pub fn save_result(state: &Path, id: &str, outcome: Outcome) -> Result<(), String> {
    save_result_for(state, id, 2, outcome)
}

pub fn save_result_for(
    state: &Path,
    id: &str,
    version: u32,
    outcome: Outcome,
) -> Result<(), String> {
    if !valid_id(id)
        || ![2, 3].contains(&version)
        || outcome == Outcome::Received
        || (version == 2 && outcome == Outcome::Prepared)
    {
        return Err("Invalid local result".into());
    }
    let folder = state.join("results");
    std::fs::create_dir_all(&folder).map_err(|_| "Cannot create local results")?;
    let mut entries: Vec<_> = std::fs::read_dir(&folder)
        .map_err(|_| "Cannot inspect local results")?
        .take(201)
        .flatten()
        .filter_map(|entry| {
            let meta = std::fs::symlink_metadata(entry.path()).ok()?;
            (meta.file_type().is_file()).then_some((meta.modified().ok()?, entry.path()))
        })
        .collect();
    entries.sort_by_key(|(time, _)| *time);
    let excess = entries.len().saturating_sub(99);
    for (index, (time, path)) in entries.into_iter().enumerate() {
        if index < excess || time.elapsed().is_ok_and(|age| age.as_secs() >= 86400) {
            std::fs::remove_file(path).map_err(|_| "Cannot clean local results")?;
        }
    }
    let temporary = folder.join(format!("{id}-{}.tmp", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec(&receipt(version, id, outcome))
        .map_err(|_| "Cannot encode local result")?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "Cannot create local result")?;
    let written = file.write_all(&bytes).and_then(|_| file.sync_all());
    drop(file);
    if written.is_err() {
        let _ = std::fs::remove_file(&temporary);
        return Err("Cannot save local result".into());
    }
    let published = folder.join(format!("{id}.json"));
    let renamed = std::fs::rename(&temporary, published)
        .map_err(|_| "Cannot publish local result".to_owned());
    if renamed.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    renamed
}

pub fn receive(
    reader: &mut impl Read,
    writer: &mut impl Write,
    origin: &str,
    state: &Path,
) -> Result<bool, String> {
    let response = process(reader, origin, state);
    let (value, launch) = match response {
        Ok(value) => value,
        Err(error) => (serde_json::json!({"ok":false,"error":error}), false),
    };
    let bytes = serde_json::to_vec(&value).map_err(|_| "Cannot encode response")?;
    writer
        .write_all(&(bytes.len() as u32).to_ne_bytes())
        .and_then(|_| writer.write_all(&bytes))
        .and_then(|_| writer.flush())
        .map_err(|_| "Cannot write native response".to_owned())?;
    Ok(launch)
}

fn process(
    reader: &mut impl Read,
    origin: &str,
    state: &Path,
) -> Result<(serde_json::Value, bool), String> {
    if origin != format!("chrome-extension://{}/", extension_id()) {
        return Err("Unexpected extension identity".into());
    }
    let mut prefix = [0u8; 4];
    reader
        .read_exact(&mut prefix)
        .map_err(|_| "Missing message length")?;
    let length = u32::from_ne_bytes(prefix) as usize;
    if length == 0 || length > 32768 {
        return Err("Native message size rejected".into());
    }
    let mut data = vec![0; length];
    reader
        .read_exact(&mut data)
        .map_err(|_| "Truncated native message")?;
    let request: Request = serde_json::from_slice(&data).map_err(|_| "Invalid native message")?;
    if request.version == 3 {
        return capture::receive(request, state);
    }
    if ![1, 2].contains(&request.version) {
        return Err("Unsupported message version".into());
    }
    let legacy = request.version == 1;
    let id = if legacy {
        if request.id.is_some() || request.action.is_some() || request.browser.is_some() {
            return Err("Invalid native message".into());
        }
        uuid::Uuid::new_v4().to_string()
    } else {
        let id = request.id.ok_or("Missing request ID")?;
        if !valid_id(&id) {
            return Err("Invalid request ID".into());
        }
        for action in ["prepare", "prepare_video", "activate", "cancel_prepare"] {
            if state
                .join("inbox")
                .join(format!("{id}-{action}.json"))
                .try_exists()
                .map_err(|_| "Cannot inspect local inbox")?
            {
                return Err("Request ID is already in use".into());
            }
        }
        if request.action.as_deref() == Some("health") && request.url.is_none() {
            let browser = request.browser.ok_or("Missing browser")?;
            return Ok((health::answer(state, browser, &id)?, false));
        }
        if request.browser.is_some() {
            return Err("Unexpected browser metadata".into());
        }
        if request.action.as_deref() == Some("status") && request.url.is_none() {
            if let Some(saved) = result(state, &id)? {
                if saved.version != 2 {
                    return Err("Request ID is already in use".into());
                }
                return Ok((receipt(2, &id, saved.outcome), false));
            }
            let pending = state.join("inbox").join(format!("{id}.json"));
            return Ok((
                receipt(
                    2,
                    &id,
                    if pending
                        .try_exists()
                        .map_err(|_| "Cannot inspect local inbox")?
                    {
                        Outcome::Received
                    } else {
                        Outcome::Rejected {
                            code: Rejection::Expired,
                        }
                    },
                ),
                false,
            ));
        }
        if request.action.as_deref() != Some("enqueue") {
            return Err("Invalid native message".into());
        }
        id
    };
    let url = request.url.ok_or("Missing download link")?;
    zipzap_core::validate_url(&url).map_err(|_| "Invalid download link")?;
    let enqueue = (|| {
        if !legacy {
            if let Some(saved) = result(state, &id)? {
                if saved.version != 2 {
                    return Err("Request ID is already in use".into());
                }
                return Ok((receipt(2, &id, saved.outcome), false));
            }
            let pending = state.join("inbox").join(format!("{id}.json"));
            if pending
                .try_exists()
                .map_err(|_| "Cannot inspect local inbox")?
            {
                let previous: Inbox = serde_json::from_slice(&read_local(&pending)?)
                    .map_err(|_| "Invalid local request")?;
                if previous.id != id || previous.url != url || previous.version != 2 {
                    return Err("Request ID is already in use".into());
                }
                return Ok((receipt(2, &id, Outcome::Received), true));
            }
        }
        let folder = state.join("inbox");
        std::fs::create_dir_all(&folder).map_err(|_| "Cannot create local inbox")?;
        if std::fs::read_dir(&folder)
            .map_err(|_| "Cannot inspect local inbox")?
            .take(101)
            .count()
            >= 100
        {
            return Err("ZipZap inbox is full; open the application".into());
        }
        let path = folder.join(format!("{id}.tmp"));
        let pending = Inbox {
            created_at: None,
            action: None,
            version: request.version,
            id: id.clone(),
            url,
        };
        let bytes = serde_json::to_vec(&pending).map_err(|_| "Cannot encode local request")?;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "Cannot create local request")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot save local request")?;
        drop(file);
        std::fs::rename(&path, folder.join(format!("{id}.json")))
            .map_err(|_| "Cannot publish local request")?;
        Ok((
            if legacy {
                serde_json::json!({"ok":true,"id":id})
            } else {
                receipt(2, &id, Outcome::Received)
            },
            true,
        ))
    })();
    match enqueue {
        Err(error) if !legacy => Ok((
            receipt(
                2,
                &id,
                Outcome::Rejected {
                    code: if error == "ZipZap inbox is full; open the application" {
                        Rejection::InboxFull
                    } else {
                        Rejection::HostRejected
                    },
                },
            ),
            false,
        )),
        outcome => outcome,
    }
}

#[cfg(windows)]
pub fn register(binary: &Path, state: &Path) -> Result<(), String> {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};
    if !binary.is_file() {
        return Err("Native host binary is missing".into());
    }
    std::fs::create_dir_all(state).map_err(|e| e.to_string())?;
    let manifest = state.join("native-host.json");
    let value = serde_json::json!({"name":HOST,"description":"ZipZap browser handoff","path":binary,"type":"stdio","allowed_origins":[format!("chrome-extension://{}/",extension_id())]});
    std::fs::write(
        &manifest,
        serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let current = RegKey::predef(HKEY_CURRENT_USER);
    for vendor in ["Google\\Chrome", "Microsoft\\Edge"] {
        let (key, _) = current
            .create_subkey(format!("Software\\{vendor}\\NativeMessagingHosts\\{HOST}"))
            .map_err(|e| e.to_string())?;
        key.set_value("", &manifest.to_string_lossy().to_string())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
pub fn unregister(binary: &Path, state: &Path) -> Result<(), String> {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};
    let manifest = state.join("native-host.json");
    if !manifest
        .try_exists()
        .map_err(|_| "Cannot inspect native registration")?
    {
        return Ok(());
    }
    let value: serde_json::Value = serde_json::from_slice(&read_local(&manifest)?)
        .map_err(|_| "Invalid native registration")?;
    // Another installation may own the shared registration; never remove its bridge.
    if value["name"] != HOST
        || value["path"]
            .as_str()
            .is_none_or(|path| !path.eq_ignore_ascii_case(&binary.to_string_lossy()))
    {
        return Ok(());
    }
    let current = RegKey::predef(HKEY_CURRENT_USER);
    for vendor in ["Google\\Chrome", "Microsoft\\Edge"] {
        let path = format!("Software\\{vendor}\\NativeMessagingHosts\\{HOST}");
        let registered: Option<String> = current
            .open_subkey(&path)
            .ok()
            .and_then(|key| key.get_value("").ok());
        if registered
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case(&manifest.to_string_lossy()))
        {
            current
                .delete_subkey(&path)
                .map_err(|_| "Cannot remove owned native registration")?;
        }
    }
    std::fs::remove_file(manifest).map_err(|_| "Cannot remove owned native manifest".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn unregister_keeps_a_different_installation_and_removes_only_its_owned_manifest() {
        let temp = tempfile::tempdir().unwrap();
        let binary = temp.path().join("host.exe");
        let manifest = temp.path().join("native-host.json");
        let foreign = serde_json::to_vec(
            &serde_json::json!({"name":HOST,"path":temp.path().join("other.exe")}),
        )
        .unwrap();
        std::fs::write(&manifest, &foreign).unwrap();
        unregister(&binary, temp.path()).unwrap();
        assert_eq!(std::fs::read(&manifest).unwrap(), foreign);
        std::fs::write(
            &manifest,
            serde_json::to_vec(&serde_json::json!({"name":HOST,"path":binary})).unwrap(),
        )
        .unwrap();
        unregister(&binary, temp.path()).unwrap();
        assert!(!manifest.exists());
        unregister(&binary, temp.path()).unwrap();
    }
    #[test]
    fn health_validates_schema_and_never_requests_app_launch() {
        let temp = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let origin = format!("chrome-extension://{}/", extension_id());
        let bytes = serde_json::to_vec(
            &serde_json::json!({"version":2,"action":"health","id":id,"browser":"edge"}),
        )
        .unwrap();
        let mut input = (bytes.len() as u32).to_ne_bytes().to_vec();
        input.extend(bytes);
        let mut output = Vec::new();
        assert!(!receive(&mut &input[..], &mut output, &origin, temp.path()).unwrap());
        let health: serde_json::Value = serde_json::from_slice(&output[4..]).unwrap();
        assert_eq!(health["state"], "health");
        assert_eq!(health["app_ready"], false);
        for payload in [
            serde_json::json!({"version":2,"action":"health","id":id,"browser":"firefox"}),
            serde_json::json!({"version":2,"action":"health","id":id,"browser":"chrome","url":"https://example.com"}),
            serde_json::json!({"version":1,"action":"health","browser":"chrome"}),
        ] {
            assert_eq!(
                send(&serde_json::to_vec(&payload).unwrap(), &origin, temp.path())["ok"],
                false
            );
        }
        assert!(!temp.path().join("inbox").exists());
    }
    fn send(payload: &[u8], origin: &str, state: &Path) -> serde_json::Value {
        let mut input = (payload.len() as u32).to_ne_bytes().to_vec();
        input.extend_from_slice(payload);
        let mut output = Vec::new();
        receive(&mut &input[..], &mut output, origin, state).unwrap();
        assert_eq!(
            u32::from_ne_bytes(output[..4].try_into().unwrap()) as usize,
            output.len() - 4
        );
        serde_json::from_slice(&output[4..]).unwrap()
    }
    #[test]
    fn validates_origin_schema_and_url_before_writing() {
        let temp = tempfile::tempdir().unwrap();
        let origin = format!("chrome-extension://{}/", extension_id());
        for payload in [
            br#"{"version":1,"url":"file:///private"}"#.as_slice(),
            br#"{"version":2,"url":"https://example.com"}"#,
            br#"{"version":1,"url":"https://example.com","folder":"/tmp"}"#,
            b"bad json",
        ] {
            assert_eq!(send(payload, &origin, temp.path())["ok"], false);
        }
        assert_eq!(
            send(
                br#"{"version":1,"url":"https://example.com"}"#,
                "chrome-extension://wrong/",
                temp.path()
            )["ok"],
            false
        );
        assert!(!temp.path().join("inbox").exists());
        let answer = send(
            br#"{"version":1,"url":"https://example.com/file.zip"}"#,
            &origin,
            temp.path(),
        );
        assert_eq!(answer["ok"], true);
        assert!(
            temp.path()
                .join("inbox")
                .join(format!("{}.json", answer["id"].as_str().unwrap()))
                .is_file()
        );
    }
    #[test]
    fn rejects_oversized_and_truncated_frames() {
        let temp = tempfile::tempdir().unwrap();
        let origin = format!("chrome-extension://{}/", extension_id());
        let mut out = Vec::new();
        receive(
            &mut &u32::MAX.to_ne_bytes()[..],
            &mut out,
            &origin,
            temp.path(),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&out[4..]).unwrap()["ok"],
            false
        );
        let mut input = 20u32.to_ne_bytes().to_vec();
        input.extend_from_slice(b"{}");
        let mut out = Vec::new();
        receive(&mut &input[..], &mut out, &origin, temp.path()).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&out[4..]).unwrap()["ok"],
            false
        );
    }

    #[test]
    fn version_two_receipt_replay_and_final_results_are_distinct() {
        let temp = tempfile::tempdir().unwrap();
        let origin = format!("chrome-extension://{}/", extension_id());
        let id = uuid::Uuid::new_v4().to_string();
        let enqueue = serde_json::to_vec(&serde_json::json!({"version":2,"action":"enqueue","id":id,"url":"https://example.com/file?secret=private"})).unwrap();
        let status =
            serde_json::to_vec(&serde_json::json!({"version":2,"action":"status","id":id}))
                .unwrap();
        assert_eq!(send(&status, &origin, temp.path())["code"], "expired");
        assert!(!temp.path().join("inbox").exists());
        assert_eq!(send(&enqueue, &origin, temp.path())["state"], "received");
        assert_eq!(send(&enqueue, &origin, temp.path())["id"], id);
        assert_eq!(
            std::fs::read_dir(temp.path().join("inbox"))
                .unwrap()
                .count(),
            1
        );
        assert_eq!(send(&status, &origin, temp.path())["state"], "received");
        save_result(temp.path(), &id, Outcome::Queued).unwrap();
        assert_eq!(send(&status, &origin, temp.path())["state"], "queued");
        assert_eq!(send(&enqueue, &origin, temp.path())["state"], "queued");
        save_result(
            temp.path(),
            &id,
            Outcome::Rejected {
                code: Rejection::Destination,
            },
        )
        .unwrap();
        let rejected = send(&status, &origin, temp.path());
        assert_eq!(rejected["code"], "destination");
        assert!(!rejected.to_string().contains("secret"));
        assert!(!rejected.to_string().contains("example.com"));
    }

    #[test]
    fn rejects_invalid_ids_actions_and_result_payloads() {
        let temp = tempfile::tempdir().unwrap();
        let origin = format!("chrome-extension://{}/", extension_id());
        let id = uuid::Uuid::new_v4().to_string();
        for value in [
            serde_json::json!({"version":2,"action":"status","id":"../escape"}),
            serde_json::json!({"version":2,"action":"status","id":id,"url":"https://example.com"}),
            serde_json::json!({"version":2,"action":"execute","id":id}),
            serde_json::json!({"version":1,"id":id,"url":"https://example.com"}),
        ] {
            assert_eq!(
                send(&serde_json::to_vec(&value).unwrap(), &origin, temp.path())["ok"],
                false
            );
        }
        assert!(!temp.path().join("inbox").exists());
        save_result(temp.path(), &id, Outcome::Queued).unwrap();
        let path = temp.path().join("results").join(format!("{id}.json"));
        for payload in [
            serde_json::json!({"version":2,"id":id,"state":"rejected","code":"https://private/token"}),
            serde_json::json!({"version":2,"id":id,"state":"received"}),
            serde_json::json!({"version":2,"id":"another","state":"queued"}),
        ] {
            std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
            assert!(result(temp.path(), &id).is_err());
        }
    }

    #[test]
    fn only_enqueue_can_request_app_launch_and_inbox_quota_is_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let origin = format!("chrome-extension://{}/", extension_id());
        let id = uuid::Uuid::new_v4().to_string();
        for (action, launch) in [("enqueue", true), ("status", false)] {
            let mut value = serde_json::json!({"version":2,"action":action,"id":id});
            if launch {
                value["url"] = "https://example.com/file".into();
            }
            let bytes = serde_json::to_vec(&value).unwrap();
            let mut input = (bytes.len() as u32).to_ne_bytes().to_vec();
            input.extend(bytes);
            assert_eq!(
                receive(&mut &input[..], &mut Vec::new(), &origin, temp.path()).unwrap(),
                launch
            );
        }
        for index in 1..100 {
            std::fs::write(
                temp.path().join("inbox").join(format!("{index}.tmp")),
                b"pending",
            )
            .unwrap();
        }
        let payload = serde_json::to_vec(&serde_json::json!({"version":2,"action":"enqueue","id":uuid::Uuid::new_v4().to_string(),"url":"https://example.com/other"})).unwrap();
        assert_eq!(send(&payload, &origin, temp.path())["code"], "inbox_full");
        assert_eq!(
            std::fs::read_dir(temp.path().join("inbox"))
                .unwrap()
                .count(),
            100
        );
    }

    #[test]
    fn result_retention_is_bounded_and_expires_without_replaying_work() {
        let temp = tempfile::tempdir().unwrap();
        let mut first = String::new();
        for index in 0..105 {
            let id = uuid::Uuid::new_v4().to_string();
            if index == 0 {
                first = id.clone();
            }
            save_result(temp.path(), &id, Outcome::Queued).unwrap();
            if index == 0 {
                std::fs::OpenOptions::new()
                    .write(true)
                    .open(temp.path().join("results").join(format!("{id}.json")))
                    .unwrap()
                    .set_times(std::fs::FileTimes::new().set_modified(
                        std::time::SystemTime::now() - std::time::Duration::from_secs(86401),
                    ))
                    .unwrap();
                assert!(result(temp.path(), &id).unwrap().is_none());
            }
        }
        assert!(result(temp.path(), &first).unwrap().is_none());
        assert_eq!(
            std::fs::read_dir(temp.path().join("results"))
                .unwrap()
                .count(),
            100
        );
        assert!(!temp.path().join("inbox").exists());
    }
}
