use super::*;
use sha2::{Digest, Sha256};

fn fixture(status: Status) -> (tempfile::TempDir, Arc<Manager>, Connection, Job) {
    let folder = tempfile::tempdir().unwrap();
    let database = folder.path().join("state.sqlite");
    let manager = Manager::open(&database).unwrap();
    let job = manager
        .add("https://example.com/file.bin", folder.path(), None)
        .unwrap();
    manager
        .update(&job.id, |j| {
            j.status = status;
            j.total = Some(12);
            j.downloaded = 6;
            j.speed = 123;
            j.segments = vec![Segment {
                start: 0,
                end: Some(11),
                done: 6,
                hash: Sha256::digest(b"prefix")
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect(),
            }];
        })
        .unwrap();
    std::fs::write(
        folder.path().join(format!(".zipzap-{}.part0", job.id)),
        b"prefix",
    )
    .unwrap();
    let job = manager.job(&job.id).unwrap();
    let db = Connection::open(database).unwrap();
    (folder, manager, db, job)
}

fn reject_updates(db: &Connection) {
    db.execute_batch(
        "CREATE TRIGGER reject_update BEFORE UPDATE ON jobs
         BEGIN SELECT RAISE(ABORT, 'injected update failure'); END;",
    )
    .unwrap();
}

fn saved(db: &Connection, id: &str) -> serde_json::Value {
    let data: String = db
        .query_row("SELECT data FROM jobs WHERE id=?1", [id], |r| r.get(0))
        .unwrap();
    serde_json::from_str(&data).unwrap()
}

#[tokio::test]
async fn failed_actions_preserve_state_tokens_and_parts_until_retry() {
    for (status, action, expected) in [
        (Status::Queued, "pause", Status::Paused),
        (Status::Downloading, "pause", Status::Paused),
        (Status::Paused, "resume", Status::Queued),
        (Status::Failed, "resume", Status::Queued),
        (Status::Queued, "cancel", Status::Cancelled),
        (Status::Paused, "cancel", Status::Cancelled),
        (Status::Downloading, "cancel", Status::Cancelled),
    ] {
        let (folder, manager, db, job) = fixture(status.clone());
        let before = serde_json::to_value(&job).unwrap();
        let token = CancellationToken::new();
        if status == Status::Downloading {
            manager
                .state
                .lock()
                .unwrap()
                .running
                .insert(job.id.clone(), token.clone());
        }
        reject_updates(&db);
        assert!(
            manager
                .action(&job.id, action)
                .unwrap_err()
                .contains("injected update failure")
        );
        assert_eq!(
            serde_json::to_value(manager.job(&job.id).unwrap()).unwrap(),
            before
        );
        assert_eq!(saved(&db, &job.id), before);
        assert!(!token.is_cancelled());
        let part = folder.path().join(format!(".zipzap-{}.part0", job.id));
        assert_eq!(std::fs::read(&part).unwrap(), b"prefix");

        db.execute_batch("DROP TRIGGER reject_update;").unwrap();
        manager.action(&job.id, action).unwrap();
        assert_eq!(manager.job(&job.id).unwrap().status, expected);
        if status == Status::Downloading {
            assert!(token.is_cancelled());
            manager.worker(&job.id, token).await;
        }
        assert_eq!(
            saved(&db, &job.id),
            serde_json::to_value(manager.job(&job.id).unwrap()).unwrap()
        );
        if expected == Status::Cancelled {
            assert!(!part.exists());
        } else {
            assert_eq!(std::fs::read(&part).unwrap(), b"prefix");
        }
        drop(manager);
        let reopened = Manager::open(&folder.path().join("state.sqlite")).unwrap();
        assert_eq!(reopened.job(&job.id).unwrap().status, expected);
    }
}

#[test]
fn failed_checkpoint_does_not_advance_live_or_saved_prefix() {
    let (folder, manager, db, job) = fixture(Status::Downloading);
    reject_updates(&db);
    let before = serde_json::to_value(&job).unwrap();
    assert!(
        manager
            .update(&job.id, |j| {
                j.segments[0].done = 12;
                j.segments[0].hash = "unsaved hash".into();
                j.validator = Some("unsaved validator".into());
                j.recovery_mode = Some(RecoveryMode::ValidatedResume);
            })
            .is_err()
    );
    assert_eq!(
        serde_json::to_value(manager.job(&job.id).unwrap()).unwrap(),
        before
    );
    assert_eq!(saved(&db, &job.id), before);
    assert_eq!(
        std::fs::read(folder.path().join(format!(".zipzap-{}.part0", job.id))).unwrap(),
        b"prefix"
    );
}

#[tokio::test]
async fn terminal_save_failure_is_visible_releases_worker_and_allows_repair() {
    let (folder, manager, db, job) = fixture(Status::Downloading);
    let token = CancellationToken::new();
    token.cancel();
    manager
        .state
        .lock()
        .unwrap()
        .running
        .insert(job.id.clone(), token.clone());
    reject_updates(&db);
    manager.worker(&job.id, token).await;
    let failed = manager.job(&job.id).unwrap();
    assert_eq!(failed.status, Status::Failed);
    assert_eq!(failed.speed, 0);
    assert!(failed.error.unwrap().contains("injected update failure"));
    assert!(manager.state.lock().unwrap().running.is_empty());
    assert_eq!(saved(&db, &job.id), serde_json::to_value(&job).unwrap());
    assert_eq!(
        std::fs::read(folder.path().join(format!(".zipzap-{}.part0", job.id))).unwrap(),
        b"prefix"
    );
    db.execute_batch("DROP TRIGGER reject_update;").unwrap();
    manager.action(&job.id, "resume").unwrap();
    assert_eq!(manager.job(&job.id).unwrap().status, Status::Queued);
    assert!(manager.job(&job.id).unwrap().error.is_none());
    drop(manager);
    let reopened = Manager::open(&folder.path().join("state.sqlite")).unwrap();
    assert_eq!(reopened.job(&job.id).unwrap().status, Status::Queued);
    assert_eq!(reopened.job(&job.id).unwrap().segments[0].done, 6);
}

#[tokio::test]
async fn worker_exit_preserves_durable_pause_resume_and_cancel_during_storage_failure() {
    for action in ["pause", "resume", "cancel"] {
        let (folder, manager, db, job) = fixture(Status::Downloading);
        let token = CancellationToken::new();
        manager
            .state
            .lock()
            .unwrap()
            .running
            .insert(job.id.clone(), token.clone());
        manager.action(&job.id, "pause").unwrap();
        if action != "pause" {
            manager.action(&job.id, action).unwrap();
        }
        let before = saved(&db, &job.id);
        reject_updates(&db);
        manager.worker(&job.id, token).await;
        assert!(manager.state.lock().unwrap().running.is_empty());
        assert_eq!(
            serde_json::to_value(manager.job(&job.id).unwrap()).unwrap(),
            before
        );
        assert_eq!(saved(&db, &job.id), before);
        let part = folder.path().join(format!(".zipzap-{}.part0", job.id));
        assert_eq!(part.exists(), action != "cancel");
    }
}

#[tokio::test]
async fn scheduler_save_failure_keeps_saved_queue_and_does_not_start_a_worker() {
    let (_folder, manager, db, job) = fixture(Status::Queued);
    reject_updates(&db);
    manager.start();
    tokio::time::timeout(Duration::from_secs(2), async {
        while manager.job(&job.id).unwrap().status != Status::Failed {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let failed = manager.job(&job.id).unwrap();
    assert!(failed.error.unwrap().contains("last saved state retained"));
    assert_eq!(failed.speed, 0);
    assert_eq!(saved(&db, &job.id), serde_json::to_value(&job).unwrap());
    assert!(manager.state.lock().unwrap().running.is_empty());
    manager.shutdown().await;
    db.execute_batch("DROP TRIGGER reject_update;").unwrap();
    manager.action(&job.id, "resume").unwrap();
    assert_eq!(saved(&db, &job.id)["status"], "queued");
}

#[tokio::test]
async fn link_replacement_save_failure_and_cancellation_preserve_the_old_job_and_parts() {
    use std::io::{Read, Write};
    let (_folder, manager, db, job) = fixture(Status::Paused);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!(
        "http://{}/replacement?token=PRIVATE",
        listener.local_addr().unwrap()
    );
    let server = std::thread::spawn(move || {
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                assert_eq!(socket.read(&mut byte).unwrap(), 1);
                request.push(byte[0]);
            }
            socket.write_all(b"HTTP/1.1 206 Partial Content\r\nConnection: close\r\nContent-Length: 1\r\nContent-Range: bytes 0-0/12\r\nETag: \"v1\"\r\n\r\nx").unwrap();
        }
    });
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(
        manager
            .replace_link(&job.id, &url, true, &cancelled)
            .await
            .unwrap_err()
            .contains("cancelled")
    );
    assert!(
        manager
            .replace_link(&job.id, "file:///private", true, &CancellationToken::new())
            .await
            .is_err()
    );
    manager
        .state
        .lock()
        .unwrap()
        .running
        .insert(job.id.clone(), CancellationToken::new());
    assert!(
        manager
            .replace_link(&job.id, &url, true, &CancellationToken::new())
            .await
            .unwrap_err()
            .contains("worker")
    );
    manager.state.lock().unwrap().running.remove(&job.id);
    reject_updates(&db);
    let error = manager
        .replace_link(&job.id, &url, true, &CancellationToken::new())
        .await
        .unwrap_err();
    assert!(error.contains("injected update failure"));
    assert!(!error.contains("PRIVATE"));
    assert_eq!(manager.job(&job.id).unwrap(), job);
    assert_eq!(saved(&db, &job.id), serde_json::to_value(&job).unwrap());
    assert_eq!(std::fs::read(transfer::part(&job, 0)).unwrap(), b"prefix");
    db.execute_batch("DROP TRIGGER reject_update").unwrap();
    assert_eq!(
        manager
            .replace_link(&job.id, &url, true, &CancellationToken::new())
            .await
            .unwrap(),
        LinkReplacement::Updated { retained_bytes: 0 }
    );
    let updated = manager.job(&job.id).unwrap();
    assert_eq!(updated.id, job.id);
    assert_eq!(updated.destination, job.destination);
    assert_eq!(updated.url, url);
    assert_eq!(updated.status, Status::Paused);
    assert!(updated.segments.is_empty());
    assert!(!transfer::part(&job, 0).exists());
    server.join().unwrap();
}

#[tokio::test]
async fn cancelling_link_replacement_while_the_probe_body_stalls_keeps_recovery() {
    use std::io::{Read, Write};
    let (_folder, manager, db, job) = fixture(Status::Failed);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/replacement", listener.local_addr().unwrap());
    let (ready, waiting) = tokio::sync::oneshot::channel();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut request = Vec::new();
        let mut byte = [0];
        while !request.ends_with(b"\r\n\r\n") {
            assert_eq!(socket.read(&mut byte).unwrap(), 1);
            request.push(byte[0]);
        }
        socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 1\r\nContent-Range: bytes 0-0/12\r\nETag: \"v1\"\r\n\r\n").unwrap();
        ready.send(()).unwrap();
        assert_eq!(socket.read(&mut byte).unwrap(), 0);
    });
    let owner = Arc::clone(&manager);
    let id = job.id.clone();
    let token = CancellationToken::new();
    let child = token.clone();
    let operation = tokio::spawn(async move { owner.replace_link(&id, &url, true, &child).await });
    waiting.await.unwrap();
    token.cancel();
    let result = tokio::time::timeout(Duration::from_secs(2), operation)
        .await
        .unwrap()
        .unwrap();
    assert!(result.unwrap_err().contains("cancelled"));
    assert_eq!(manager.job(&job.id).unwrap(), job);
    assert_eq!(saved(&db, &job.id), serde_json::to_value(&job).unwrap());
    assert_eq!(std::fs::read(transfer::part(&job, 0)).unwrap(), b"prefix");
    server.join().unwrap();
}

#[tokio::test]
async fn link_replacement_rechecks_the_job_after_an_inflight_probe() {
    use std::io::{Read, Write};
    let (_folder, manager, db, job) = fixture(Status::Paused);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/replacement", listener.local_addr().unwrap());
    let (ready, waiting) = tokio::sync::oneshot::channel();
    let (release, released) = std::sync::mpsc::channel();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut request = Vec::new();
        let mut byte = [0];
        while !request.ends_with(b"\r\n\r\n") {
            assert_eq!(socket.read(&mut byte).unwrap(), 1);
            request.push(byte[0]);
        }
        ready.send(()).unwrap();
        released.recv_timeout(Duration::from_secs(3)).unwrap();
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 12\r\n\r\n")
            .unwrap();
    });
    let owner = Arc::clone(&manager);
    let id = job.id.clone();
    let operation = tokio::spawn(async move {
        owner
            .replace_link(&id, &url, true, &CancellationToken::new())
            .await
    });
    waiting.await.unwrap();
    manager.action(&job.id, "resume").unwrap();
    release.send(()).unwrap();
    assert!(operation.await.unwrap().unwrap_err().contains("changed"));
    assert_eq!(manager.job(&job.id).unwrap().url, job.url);
    assert_eq!(saved(&db, &job.id)["status"], "queued");
    assert_eq!(std::fs::read(transfer::part(&job, 0)).unwrap(), b"prefix");
    server.join().unwrap();
}
