use crate::{
    Inbox, Outcome, Receipt, Rejection, Request, health::now, read_local, receipt, result,
    valid_id, write_local,
};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Proposal {
    #[serde(default)]
    pub video: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub id: String,
    pub url: String,
    pub folder: PathBuf,
    pub filename: String,
    pub deadline: u64,
}

fn proposal_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Invalid request ID".into());
    }
    Ok(root.join("prepared").join(format!("{id}.json")))
}

pub fn proposal(root: &Path, id: &str) -> Result<Option<Proposal>, String> {
    let path = proposal_path(root, id)?;
    if !path
        .try_exists()
        .map_err(|_| "Cannot inspect capture proposal")?
    {
        return Ok(None);
    }
    let saved: Proposal =
        serde_json::from_slice(&read_local(&path)?).map_err(|_| "Invalid capture proposal")?;
    let time = now();
    if saved.id != id || saved.deadline > time.saturating_add(60) {
        return Err("Invalid capture proposal".into());
    }
    if saved.deadline <= time {
        return Ok(None);
    }
    let url = zipzap_core::validate_url(&saved.url).map_err(|_| "Invalid capture link")?;
    let video_valid = if saved.video {
        saved.source.as_deref().is_some_and(|source| {
            if crate::video::youtube_id(source).is_some() {
                crate::video::resolved(url.as_str())
            } else {
                crate::video::direct(source) && source == url.as_str()
            }
        })
    } else {
        saved.source.is_none() && url.query().is_none()
    };
    if !video_valid {
        return Err("Capture requires a public direct link".into());
    }
    Ok(Some(saved))
}

pub fn cleanup(root: &Path) -> Result<(), String> {
    let folder = root.join("prepared");
    if !folder
        .try_exists()
        .map_err(|_| "Cannot inspect capture proposals")?
    {
        return Ok(());
    }
    for entry in std::fs::read_dir(folder)
        .map_err(|_| "Cannot inspect capture proposals")?
        .take(101)
    {
        let entry = entry.map_err(|_| "Cannot inspect capture proposal")?;
        let path = entry.path();
        if path.extension().and_then(|name| name.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|name| name.to_str()) else {
            continue;
        };
        if valid_id(id) && proposal(root, id)?.is_none() {
            std::fs::remove_file(path).map_err(|_| "Cannot retire capture proposal")?;
        }
    }
    Ok(())
}

pub fn save_proposal(root: &Path, value: &Proposal) -> Result<(), String> {
    proposal_path(root, &value.id)?;
    cleanup(root)?;
    if let Some(saved) = proposal(root, &value.id)? {
        return if saved == *value {
            Ok(())
        } else {
            Err("Request ID is already in use".into())
        };
    }
    let time = now();
    if value.deadline <= time || value.deadline > time.saturating_add(60) {
        return Err("Invalid proposal deadline".into());
    }
    let folder = root.join("prepared");
    std::fs::create_dir_all(&folder).map_err(|_| "Cannot create capture proposals")?;
    if std::fs::read_dir(&folder)
        .map_err(|_| "Cannot inspect capture proposals")?
        .take(101)
        .count()
        >= 100
    {
        return Err("Capture proposal limit reached".into());
    }
    write_local(&folder, &format!("{}.json", value.id), value)
}

pub fn remove_proposal(root: &Path, id: &str) {
    if let Ok(path) = proposal_path(root, id) {
        let _ = std::fs::remove_file(path);
    }
}

fn answer(saved: Receipt) -> Result<(serde_json::Value, bool), String> {
    if saved.version != 3 {
        return Err("Request ID is already in use".into());
    }
    Ok((receipt(3, &saved.id, saved.outcome), false))
}

pub(crate) fn receive(request: Request, root: &Path) -> Result<(serde_json::Value, bool), String> {
    let id = request.id.ok_or("Missing request ID")?;
    if !valid_id(&id) || request.browser.is_some() {
        return Err("Invalid capture request".into());
    }
    if root
        .join("inbox")
        .join(format!("{id}.json"))
        .try_exists()
        .map_err(|_| "Cannot inspect local inbox")?
    {
        return Err("Request ID is already in use".into());
    }
    let action = request
        .action
        .as_deref()
        .ok_or("Missing capture operation")?;
    if action == "status" && request.url.is_none() {
        if let Some(saved) = result(root, &id)? {
            return answer(saved);
        }
        let pending = ["prepare", "prepare_video", "activate", "cancel_prepare"]
            .iter()
            .any(|action| {
                root.join("inbox")
                    .join(format!("{id}-{action}.json"))
                    .exists()
            });
        return Ok((
            receipt(
                3,
                &id,
                if pending {
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
    let url = match (action, request.url) {
        ("prepare", Some(value)) => {
            let url = zipzap_core::validate_url(&value).map_err(|_| "Invalid capture link")?;
            if url.query().is_some() {
                return Err("Capture requires a public direct link".into());
            }
            url.to_string()
        }
        ("activate" | "cancel_prepare", None) => String::new(),
        ("prepare_video", Some(value)) => crate::video::source(&value)?,
        _ => return Err("Invalid capture operation".into()),
    };
    if let Some(saved) = result(root, &id)? {
        if action.starts_with("prepare")
            && saved.version == 3
            && saved.outcome == Outcome::Prepared
            && let Some(proposal) = proposal(root, &id)?
            && (proposal.video != (action == "prepare_video")
                || if proposal.video {
                    proposal.source.as_deref() != Some(url.as_str())
                } else {
                    proposal.url != url
                })
        {
            return Err("Request ID is already in use".into());
        }
        if action.starts_with("prepare") || saved.outcome != Outcome::Prepared {
            return answer(saved);
        }
        if saved.version != 3 {
            return Err("Request ID is already in use".into());
        }
    }
    let pending = Inbox {
        created_at: Some(now()),
        version: 3,
        id: id.clone(),
        url,
        action: Some(action.to_owned()),
    };
    let stem = pending.stem()?;
    let folder = root.join("inbox");
    std::fs::create_dir_all(&folder).map_err(|_| "Cannot create local inbox")?;
    if action.starts_with("prepare") {
        let other = if action == "prepare" {
            "prepare_video"
        } else {
            "prepare"
        };
        if folder
            .join(format!("{id}-{other}.json"))
            .try_exists()
            .map_err(|_| "Cannot inspect capture inbox")?
        {
            return Err("Request ID is already in use".into());
        }
    }
    let published = folder.join(format!("{stem}.json"));
    if published
        .try_exists()
        .map_err(|_| "Cannot inspect capture inbox")?
    {
        let saved: Inbox = serde_json::from_slice(&read_local(&published)?)
            .map_err(|_| "Invalid capture inbox")?;
        if saved.version != 3
            || saved.id != id
            || saved.action != pending.action
            || saved.url != pending.url
        {
            return Err("Request ID is already in use".into());
        }
        return Ok((
            receipt(3, &id, Outcome::Received),
            action != "cancel_prepare",
        ));
    }
    if std::fs::read_dir(&folder)
        .map_err(|_| "Cannot inspect local inbox")?
        .take(101)
        .count()
        >= 100
    {
        return Ok((
            receipt(
                3,
                &id,
                Outcome::Rejected {
                    code: Rejection::InboxFull,
                },
            ),
            false,
        ));
    }
    let temporary = folder.join(format!("{stem}.tmp"));
    let bytes = serde_json::to_vec(&pending).map_err(|_| "Cannot encode capture request")?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "Cannot create capture request")?;
    let written = file.write_all(&bytes).and_then(|_| file.sync_all());
    drop(file);
    // No-clobber publication binds the UUID/action even with concurrent native hosts.
    let written = written.and_then(|_| std::fs::hard_link(&temporary, &published));
    let _ = std::fs::remove_file(temporary);
    written.map_err(|_: std::io::Error| "Cannot publish capture request")?;
    Ok((
        receipt(3, &id, Outcome::Received),
        action != "cancel_prepare",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(action: &str, id: &str, url: Option<&str>) -> Request {
        Request {
            version: 3,
            id: Some(id.into()),
            action: Some(action.into()),
            url: url.map(str::to_owned),
            browser: None,
        }
    }
    #[test]
    fn phases_replay_without_overwriting_each_other_or_another_hosts_temporary_file() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let id = uuid::Uuid::new_v4().to_string();
        assert!(
            receive(
                request("prepare", &id, Some("https://example.com/file.zip")),
                root
            )
            .unwrap()
            .1
        );
        assert!(receive(request("activate", &id, None), root).unwrap().1);
        let path = root.join(format!("inbox/{id}-prepare.json"));
        let bytes = std::fs::read(&path).unwrap();
        assert!(
            receive(
                request("prepare", &id, Some("https://example.com/file.zip")),
                root
            )
            .unwrap()
            .1
        );
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert!(
            receive(
                request("prepare", &id, Some("https://example.com/other.zip")),
                root
            )
            .is_err()
        );
        assert_eq!(std::fs::read_dir(root.join("inbox")).unwrap().count(), 2);
        let other = uuid::Uuid::new_v4().to_string();
        let pending = root.join(format!("inbox/{other}-activate.tmp"));
        std::fs::write(&pending, b"owned by another host").unwrap();
        assert!(receive(request("activate", &other, None), root).is_err());
        assert_eq!(std::fs::read(pending).unwrap(), b"owned by another host");
        assert_eq!(
            receive(request("status", &other, None), root).unwrap().0["code"],
            "expired"
        );
    }
    #[test]
    fn proposals_expire_and_keep_receipts_private() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let id = uuid::Uuid::new_v4().to_string();
        let mut value = Proposal {
            video: false,
            source: None,
            id: id.clone(),
            url: "https://example.com/file.zip".into(),
            folder: root.into(),
            filename: "file.zip".into(),
            deadline: now() + 60,
        };
        save_proposal(root, &value).unwrap();
        save_proposal(root, &value).unwrap();
        value.filename = "other.zip".into();
        assert!(save_proposal(root, &value).is_err());
        value.deadline = now() - 1;
        write_local(&root.join("prepared"), &format!("{id}.json"), &value).unwrap();
        assert!(proposal(root, &id).unwrap().is_none());
        cleanup(root).unwrap();
        assert!(!proposal_path(root, &id).unwrap().exists());
        value.deadline = now() + 61;
        assert!(save_proposal(root, &value).is_err());
        assert!(crate::save_result(root, &id, Outcome::Prepared).is_err());
        crate::save_result_for(root, &id, 3, Outcome::Prepared).unwrap();
        let answer = receive(request("status", &id, None), root).unwrap();
        assert!(!answer.1);
        assert_eq!(answer.0["state"], "prepared");
        assert!(!answer.0.to_string().contains("example"));
        value.deadline = now() + 60;
        for _ in 0..100 {
            let id = uuid::Uuid::new_v4().to_string();
            std::fs::write(
                root.join("prepared").join(format!("{id}.json")),
                serde_json::to_vec(&Proposal {
                    video: false,
                    source: None,
                    id,
                    url: value.url.clone(),
                    folder: root.into(),
                    filename: "file.zip".into(),
                    deadline: value.deadline,
                })
                .unwrap(),
            )
            .unwrap();
        }
        assert!(save_proposal(root, &value).is_err());
    }
    #[test]
    fn capture_rejects_queries_credentials_unknown_actions_and_protocol_id_collisions() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let id = uuid::Uuid::new_v4().to_string();
        for url in [
            "https://example.com/f?token=private",
            "https://user:pass@example.com/f",
            "blob:https://example.com/f",
        ] {
            assert!(receive(request("prepare", &id, Some(url)), root).is_err());
        }
        assert!(
            receive(
                request("activate", &id, Some("https://example.com/f")),
                root
            )
            .is_err()
        );
        assert!(receive(request("enqueue", &id, None), root).is_err());
        crate::save_result(root, &id, Outcome::Queued).unwrap();
        assert!(receive(request("status", &id, None), root).is_err());
        assert!(receive(request("prepare", &id, Some("https://example.com/f")), root).is_err());
        assert!(!root.join("inbox").exists());
        assert!(
            serde_json::from_value::<Request>(
                serde_json::json!({"version":3,"id":id,"action":"activate","created_at":now()})
            )
            .is_err()
        );
    }

    #[test]
    fn video_and_cancel_operations_keep_source_binding_and_do_not_expand_plain_capture() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let id = uuid::Uuid::new_v4().to_string();
        let source = "https://www.youtube.com/watch?v=YE7VzlLtp-4";
        assert!(
            receive(request("prepare_video", &id, Some(source)), root)
                .unwrap()
                .1
        );
        assert!(
            receive(
                request("prepare", &id, Some("https://example.com/file.zip")),
                root
            )
            .is_err()
        );
        assert!(
            !receive(request("cancel_prepare", &id, None), root)
                .unwrap()
                .1
        );
        assert!(
            root.join(format!("inbox/{id}-cancel_prepare.json"))
                .is_file()
        );
        let proposal = Proposal {
            video: true,
            source: Some(source.into()),
            id: id.clone(),
            url: "https://r1.googlevideo.com/video?signature=private".into(),
            filename: "video.mp4".into(),
            folder: root.into(),
            deadline: now() + 60,
        };
        save_proposal(root, &proposal).unwrap();
        assert!(super::proposal(root, &id).unwrap().unwrap().video);
        crate::save_result_for(root, &id, 3, Outcome::Prepared).unwrap();
        assert!(
            receive(
                request(
                    "prepare_video",
                    &id,
                    Some("https://www.youtube.com/watch?v=AAAAAAAAAAA")
                ),
                root
            )
            .is_err()
        );
        let other = uuid::Uuid::new_v4().to_string();
        let value = serde_json::json!({"id":other,"url":"https://example.com/clip.mp4?signature=private","filename":"clip.mp4","folder":root,"deadline":now()+60});
        write_local(&root.join("prepared"), &format!("{other}.json"), &value).unwrap();
        assert!(super::proposal(root, &other).is_err());
    }
}
