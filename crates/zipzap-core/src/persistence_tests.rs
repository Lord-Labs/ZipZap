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
