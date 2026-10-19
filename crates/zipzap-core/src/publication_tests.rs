use super::*;
use sha2::{Digest, Sha256};
use std::{
    process::{Command, Stdio},
    time::Instant,
};

fn fixture() -> (tempfile::TempDir, Arc<Manager>, Connection, Job) {
    let folder = tempfile::tempdir().unwrap();
    let database = folder.path().join("state.sqlite");
    let manager = Manager::open(&database).unwrap();
    let job = manager
        .add("https://fixture.invalid/file.bin", folder.path(), None)
        .unwrap();
    manager
        .update(&job.id, |j| {
            j.status = Status::Downloading;
            j.downloaded = 6;
            j.total = Some(6);
            j.segments = vec![Segment {
                start: 0,
                end: Some(5),
                done: 6,
                hash: Sha256::digest(b"prefix")
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect(),
            }];
        })
        .unwrap();
    for index in [0, 4] {
        std::fs::write(transfer::part(&job, index), b"prefix").unwrap();
    }
    let db = Connection::open(database).unwrap();
    let job = manager.job(&job.id).unwrap();
    (folder, manager, db, job)
}

pub(super) fn fault(phase: &str) {
    if std::env::var("ZIPZAP_PUBLICATION_FAULT").as_deref() != Ok(phase) {
        return;
    }
    std::fs::write(std::env::var_os("ZIPZAP_PUBLICATION_READY").unwrap(), phase).unwrap();
    loop {
        std::thread::park();
    }
}

#[test]
fn publication_child() {
    let Some(database) = std::env::var_os("ZIPZAP_PUBLICATION_DB") else {
        return;
    };
    let manager = Manager::open(Path::new(&database)).unwrap();
    let job = manager.jobs()[0].clone();
    manager
        .update(&job.id, |j| j.status = Status::Downloading)
        .unwrap();
    publication::publish(&manager, &job.id, &CancellationToken::new()).unwrap();
}

fn crash(phase: &str) -> (tempfile::TempDir, PathBuf, Job) {
    let (folder, manager, db, job) = fixture();
    drop(manager);
    drop(db);
    let database = folder.path().join("state.sqlite");
    let ready = folder.path().join("ready");
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "publication_tests::publication_child"])
        .env("ZIPZAP_PUBLICATION_DB", &database)
        .env("ZIPZAP_PUBLICATION_FAULT", phase)
        .env("ZIPZAP_PUBLICATION_READY", &ready)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !ready.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    let _ = child.kill();
    child.wait().unwrap();
    assert!(ready.exists(), "child did not reach {phase}");
    assert_eq!(std::fs::read_to_string(ready).unwrap(), phase);
    (folder, database, job)
}

#[test]
fn publication_commits_evidence_and_keeps_the_final_file_on_cleanup() {
    let (_folder, manager, _db, job) = fixture();
    publication::publish(&manager, &job.id, &CancellationToken::new()).unwrap();
    let complete = manager.job(&job.id).unwrap();
    assert_eq!(complete.status, Status::Completed);
    assert_eq!(complete.publication.unwrap().bytes, 6);
    assert_eq!(std::fs::read(&job.destination).unwrap(), b"prefix");
    assert!(!transfer::part(&job, 0).exists());
    assert!(!transfer::part(&job, 4).exists());
    #[cfg(windows)]
    {
        assert_eq!(complete.provenance, Some(Provenance::Internet));
        assert!(has_internet_zone(&job.destination));
        assert_eq!(
            std::fs::read(zone(&job.destination)).unwrap(),
            b"[ZoneTransfer]\r\nZoneId=3\r\n"
        );
    }
}

#[cfg(windows)]
fn zone(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(":Zone.Identifier");
    PathBuf::from(value)
}

#[cfg(windows)]
#[test]
fn zone_failure_keeps_valid_bytes_and_a_durable_warning_without_lowering_restricted_zones() {
    use std::os::windows::fs::OpenOptionsExt;
    for restricted in [false, true] {
        let (folder, manager, db, job) = fixture();
        let metadata = zone(&transfer::part(&job, 4));
        std::fs::write(
            &metadata,
            if restricted {
                b"[ZoneTransfer]\r\nZoneId=4\r\n".as_slice()
            } else {
                b"unavailable"
            },
        )
        .unwrap();
        let guard = if restricted {
            None
        } else {
            Some(
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(0)
                    .open(&metadata)
                    .unwrap(),
            )
        };
        publication::publish(&manager, &job.id, &CancellationToken::new()).unwrap();
        assert_eq!(std::fs::read(&job.destination).unwrap(), b"prefix");
        let completed = manager.job(&job.id).unwrap();
        assert_eq!(completed.status, Status::Completed);
        assert_eq!(
            completed.provenance,
            Some(if restricted {
                Provenance::Internet
            } else {
                Provenance::Unavailable
            })
        );
        drop(guard);
        if restricted {
            assert!(
                std::fs::read_to_string(zone(&job.destination))
                    .unwrap()
                    .contains("ZoneId=4")
            );
        }
        assert_eq!(has_internet_zone(&job.destination), restricted);
        drop(db);
        drop(manager);
        let reopened = Manager::open(&folder.path().join("state.sqlite")).unwrap();
        assert_eq!(
            reopened.job(&job.id).unwrap().provenance,
            completed.provenance
        );
        assert_eq!(std::fs::read(&job.destination).unwrap(), b"prefix");
    }
}

#[cfg(windows)]
#[test]
fn crash_recovery_restores_missing_zone_metadata_on_the_verified_file() {
    let (_folder, database, job) = crash("after_link");
    assert!(has_internet_zone(&job.destination));
    std::fs::remove_file(zone(&job.destination)).unwrap();
    assert!(!has_internet_zone(&job.destination));
    let manager = Manager::open(&database).unwrap();
    let recovered = manager.job(&job.id).unwrap();
    assert_eq!(recovered.status, Status::Completed);
    assert_eq!(recovered.provenance, Some(Provenance::Internet));
    assert!(has_internet_zone(&job.destination));
    assert_eq!(std::fs::read(&job.destination).unwrap(), b"prefix");
}

#[test]
fn failed_evidence_save_never_publishes_a_file_and_can_be_retried() {
    let (_folder, manager, db, job) = fixture();
    db.execute_batch("CREATE TRIGGER reject_evidence BEFORE UPDATE ON jobs WHEN json_type(NEW.data, '$.publication')='object' BEGIN SELECT RAISE(ABORT, 'injected evidence save failure'); END;").unwrap();
    assert!(
        publication::publish(&manager, &job.id, &CancellationToken::new())
            .unwrap_err()
            .contains("injected evidence save failure")
    );
    assert!(!job.destination.exists());
    assert!(manager.job(&job.id).unwrap().publication.is_none());
    assert_eq!(std::fs::read(transfer::part(&job, 4)).unwrap(), b"prefix");
    db.execute_batch("DROP TRIGGER reject_evidence;").unwrap();
    publication::publish(&manager, &job.id, &CancellationToken::new()).unwrap();
    assert_eq!(manager.job(&job.id).unwrap().status, Status::Completed);
}

#[test]
fn cancelling_a_failed_publication_preserves_its_final_file_on_reopen() {
    let (folder, manager, db, job) = fixture();
    db.execute_batch("CREATE TRIGGER reject_completion BEFORE UPDATE ON jobs WHEN json_extract(NEW.data, '$.status')='completed' BEGIN SELECT RAISE(ABORT, 'injected completion save failure'); END;").unwrap();
    assert!(publication::publish(&manager, &job.id, &CancellationToken::new()).is_err());
    manager.action(&job.id, "cancel").unwrap();
    assert!(!transfer::part(&job, 4).exists());
    assert_eq!(std::fs::read(&job.destination).unwrap(), b"prefix");
    drop(manager);
    let manager = Manager::open(&folder.path().join("state.sqlite")).unwrap();
    assert_eq!(manager.job(&job.id).unwrap().status, Status::Cancelled);
    assert_eq!(std::fs::read(&job.destination).unwrap(), b"prefix");
}

#[test]
fn termination_at_publication_boundaries_recovers_idempotently() {
    for phase in ["before_link", "after_link", "after_commit"] {
        let (_folder, database, job) = crash(phase);
        assert_eq!(job.destination.exists(), phase != "before_link");
        assert!(transfer::part(&job, 4).exists());
        for _ in 0..2 {
            let manager = Manager::open(&database).unwrap();
            let recovered = manager.job(&job.id).unwrap();
            if phase == "before_link" && recovered.status != Status::Completed {
                assert_eq!(recovered.status, Status::Paused);
                assert!(recovered.publication.is_some());
                assert!(!job.destination.exists());
                manager
                    .update(&job.id, |j| j.status = Status::Downloading)
                    .unwrap();
                publication::publish(&manager, &job.id, &CancellationToken::new()).unwrap();
            }
            assert_eq!(manager.job(&job.id).unwrap().status, Status::Completed);
            assert_eq!(std::fs::read(&job.destination).unwrap(), b"prefix");
            assert!(!transfer::part(&job, 0).exists());
            assert!(!transfer::part(&job, 4).exists());
        }
    }
}

#[test]
fn damaged_or_replaced_destinations_and_evidence_are_never_adopted() {
    for damage in [
        "modified",
        "truncated",
        "replaced",
        "same_bytes",
        "missing_marker",
        "replaced_marker",
        "directory",
    ] {
        let (_folder, database, job) = crash("after_link");
        match damage {
            "modified" => std::fs::write(&job.destination, b"tamper").unwrap(),
            "truncated" => std::fs::write(&job.destination, b"x").unwrap(),
            "replaced" | "same_bytes" => {
                std::fs::remove_file(&job.destination).unwrap();
                let data: &[u8] = if damage == "replaced" {
                    b"user file"
                } else {
                    b"prefix"
                };
                std::fs::write(&job.destination, data).unwrap();
            }
            "missing_marker" => std::fs::remove_file(transfer::part(&job, 4)).unwrap(),
            "replaced_marker" => {
                std::fs::remove_file(transfer::part(&job, 4)).unwrap();
                std::fs::write(transfer::part(&job, 4), b"prefix").unwrap();
            }
            "directory" => {
                std::fs::remove_file(&job.destination).unwrap();
                std::fs::create_dir(&job.destination).unwrap();
            }
            _ => unreachable!(),
        }
        let before = std::fs::read(&job.destination).ok();
        for _ in 0..2 {
            let manager = Manager::open(&database).unwrap();
            let failed = manager.job(&job.id).unwrap();
            assert_eq!(failed.status, Status::Failed, "{damage}");
            assert!(
                failed
                    .error
                    .unwrap()
                    .starts_with("Published file conflict:")
            );
            assert!(failed.publication.is_some());
            assert_eq!(std::fs::read(&job.destination).ok(), before);
            assert_eq!(std::fs::read(transfer::part(&job, 0)).unwrap(), b"prefix");
            assert_eq!(transfer::part(&job, 4).exists(), damage != "missing_marker");
        }
    }
}

#[test]
fn rejected_recovery_save_retains_evidence_until_repair_and_retry() {
    let (_folder, database, job) = crash("after_link");
    let db = Connection::open(&database).unwrap();
    let before: String = db
        .query_row("SELECT data FROM jobs", [], |r| r.get(0))
        .unwrap();
    db.execute_batch("CREATE TRIGGER reject_completion BEFORE UPDATE ON jobs WHEN json_extract(NEW.data, '$.status')='completed' BEGIN SELECT RAISE(ABORT, 'injected recovery save failure'); END;").unwrap();
    assert!(
        Manager::open(&database)
            .err()
            .unwrap()
            .contains("injected recovery save failure")
    );
    assert_eq!(
        db.query_row("SELECT data FROM jobs", [], |r| r.get::<_, String>(0))
            .unwrap(),
        before
    );
    assert_eq!(std::fs::read(&job.destination).unwrap(), b"prefix");
    assert!(transfer::part(&job, 0).exists());
    assert!(transfer::part(&job, 4).exists());
    db.execute_batch("DROP TRIGGER reject_completion;").unwrap();
    let manager = Manager::open(&database).unwrap();
    assert_eq!(manager.job(&job.id).unwrap().status, Status::Completed);
    assert!(!transfer::part(&job, 4).exists());
}

#[test]
fn completed_recovery_does_not_clean_a_replaced_temporary_file() {
    let (_folder, database, job) = crash("after_commit");
    std::fs::remove_file(transfer::part(&job, 4)).unwrap();
    std::fs::write(transfer::part(&job, 4), b"user temporary file").unwrap();
    let manager = Manager::open(&database).unwrap();
    assert_eq!(manager.job(&job.id).unwrap().status, Status::Completed);
    assert_eq!(
        std::fs::read(transfer::part(&job, 4)).unwrap(),
        b"user temporary file"
    );
    assert_eq!(std::fs::read(&job.destination).unwrap(), b"prefix");
}
