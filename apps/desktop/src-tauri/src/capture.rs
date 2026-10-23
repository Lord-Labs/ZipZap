use std::path::Path;
use zipzap_core::{CancellationToken, Manager};
use zipzap_native::{Inbox, Outcome, Rejection, capture, health::now};

pub async fn accept(
    manager: &Manager,
    root: &Path,
    request: &Inbox,
    fallback: &Path,
) -> Result<Option<String>, String> {
    request.stem()?;
    if request.version != 3 || manager.is_stopping() {
        return Err("Capture retained during shutdown".into());
    }
    // A committed job wins over expired proposals and missing acknowledgments after a restart.
    if manager.jobs().iter().any(|job| job.id == request.id) {
        zipzap_native::save_result_for(root, &request.id, 3, Outcome::Queued)?;
        capture::remove_proposal(root, &request.id);
        return Ok(None);
    }
    let saved = zipzap_native::result(root, &request.id)?;
    if let Some(saved) = &saved {
        if saved.version != 3 {
            return Err("Request ID is already in use".into());
        }
        if saved.outcome != Outcome::Prepared {
            return Ok(None);
        }
    }
    let mut rejection = Rejection::AppRejected;
    let operation = async {
        let created = request.created_at.ok_or("Missing capture timestamp")?;
        let time = now();
        if created > time || time >= created.saturating_add(60) {
            rejection = Rejection::CaptureExpired;
            return Err("Capture expired before activation".to_owned());
        }
        if request.action.as_deref() == Some("prepare") {
            let url = zipzap_core::validate_url(&request.url)?;
            if url.query().is_some() {
                return Err("Capture requires a public direct link".into());
            }
            if let Some(proposal) = capture::proposal(root, &request.id)? {
                if proposal.url != url.as_str() {
                    return Err("Request ID is already in use".into());
                }
                return Ok(Outcome::Prepared);
            }
            if saved.is_some() {
                rejection = Rejection::CaptureExpired;
                return Err("Capture expired before activation".into());
            }
            let suggestion = manager
                .suggest_auto(url.as_str(), fallback, None, &CancellationToken::new())
                .await?;
            if suggestion.alternative.is_some() {
                rejection = Rejection::Destination;
                return Err("Capture destination is occupied".into());
            }
            let deadline = created.saturating_add(60);
            if now() >= deadline {
                rejection = Rejection::CaptureExpired;
                return Err("Capture expired while preparing".into());
            }
            capture::save_proposal(
                root,
                &capture::Proposal {
                    id: request.id.clone(),
                    url: url.to_string(),
                    folder: suggestion.destination,
                    filename: suggestion.filename,
                    deadline,
                },
            )?;
            Ok(Outcome::Prepared)
        } else {
            let Some(proposal) = capture::proposal(root, &request.id)? else {
                rejection = Rejection::CaptureExpired;
                return Err("Capture expired before activation".into());
            };
            manager.add_with_id(
                &proposal.url,
                &proposal.folder,
                Some(&proposal.filename),
                &request.id,
            )?;
            Ok(Outcome::Queued)
        }
    }
    .await;
    if manager.is_stopping() {
        return Err("Capture retained during shutdown".into());
    }
    let outcome = operation.unwrap_or(Outcome::Rejected { code: rejection });
    // Publish before retiring inbox/proposal. A failed write leaves the original UUID for replay.
    zipzap_native::save_result_for(root, &request.id, 3, outcome.clone())?;
    if outcome != Outcome::Prepared {
        capture::remove_proposal(root, &request.id);
    }
    Ok(matches!(outcome, Outcome::Rejected { .. })
        .then(|| "Browser capture was not added; check the browser message".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        time::Duration,
    };
    #[test]
    fn prepare_never_queues_and_activation_replays_after_ack_failure_and_restart() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file.bin", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut buffer = [0; 4096];
            assert!(stream.read(&mut buffer).unwrap() > 0);
            stream.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 0-0/1\r\nContent-Length: 1\r\nConnection: close\r\n\r\nx").unwrap();
        });
        tauri::async_runtime::block_on(async {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path();
            let manager = Manager::open(&root.join("state.sqlite")).unwrap();
            manager.set_queue_running(false).unwrap();
            let mut request = Inbox {
                version: 3,
                id: "c52d26bd-e6cf-4bc3-b632-caa6e35f7a13".into(),
                url,
                action: Some("prepare".into()),
                created_at: Some(now()),
            };
            accept(&manager, root, &request, root).await.unwrap();
            assert!(manager.jobs().is_empty());
            assert_eq!(
                zipzap_native::result(root, &request.id)
                    .unwrap()
                    .unwrap()
                    .outcome,
                Outcome::Prepared
            );
            accept(&manager, root, &request, root).await.unwrap();
            assert!(manager.jobs().is_empty());
            request.action = Some("activate".into());
            request.url.clear();
            std::fs::remove_dir_all(root.join("results")).unwrap();
            std::fs::write(root.join("results"), b"block acknowledgment").unwrap();
            assert!(accept(&manager, root, &request, root).await.is_err());
            assert_eq!(manager.jobs().len(), 1);
            assert!(!manager.queue().running);
            manager.shutdown().await;
            drop(manager);
            std::fs::remove_file(root.join("results")).unwrap();
            let reopened = Manager::open(&root.join("state.sqlite")).unwrap();
            request.created_at = Some(0);
            accept(&reopened, root, &request, root).await.unwrap();
            accept(&reopened, root, &request, root).await.unwrap();
            assert_eq!(reopened.jobs().len(), 1);
            assert_eq!(
                zipzap_native::result(root, &request.id)
                    .unwrap()
                    .unwrap()
                    .outcome,
                Outcome::Queued
            );
            assert!(capture::proposal(root, &request.id).unwrap().is_none());
            reopened.shutdown().await;
        });
        server.join().unwrap();
    }
    #[test]
    fn stale_missing_and_future_proposals_never_create_jobs_and_shutdown_retains_work() {
        tauri::async_runtime::block_on(async {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path();
            let manager = Manager::open(&root.join("state.sqlite")).unwrap();
            for (id, time, action) in [
                ("91c41120-b4cd-46c8-b94e-6105ec2d744d", 0, "prepare"),
                (
                    "f0ef6f23-9790-45f7-b1ee-5a076a556c4c",
                    now() + 60,
                    "prepare",
                ),
                ("841e31c7-afb4-49fd-b3c9-7ace1cce4e20", now(), "activate"),
            ] {
                let request = Inbox {
                    version: 3,
                    id: id.into(),
                    url: if action == "prepare" {
                        "https://example.com/file.zip".into()
                    } else {
                        String::new()
                    },
                    action: Some(action.into()),
                    created_at: Some(time),
                };
                assert!(
                    accept(&manager, root, &request, root)
                        .await
                        .unwrap()
                        .is_some()
                );
                assert_eq!(
                    zipzap_native::result(root, id).unwrap().unwrap().outcome,
                    Outcome::Rejected {
                        code: Rejection::CaptureExpired
                    }
                );
            }
            assert!(manager.jobs().is_empty());
            manager.shutdown().await;
            let request = Inbox {
                version: 3,
                id: "eb8aad74-a3f7-46b3-835a-14c303248c93".into(),
                url: String::new(),
                action: Some("activate".into()),
                created_at: Some(now()),
            };
            assert!(accept(&manager, root, &request, root).await.is_err());
            assert!(zipzap_native::result(root, &request.id).unwrap().is_none());
        });
    }
}
