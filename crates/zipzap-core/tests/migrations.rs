use rusqlite::{Connection, params};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use zipzap_core::{Job, Manager, Settings, Status};

fn fixture(schema: u32) -> (tempfile::TempDir, PathBuf, Connection, Vec<Job>, Settings) {
    let folder = tempfile::tempdir().unwrap();
    let database = folder.path().join("state.sqlite");
    let db = Connection::open(&database).unwrap();
    db.execute_batch("CREATE TABLE jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);").unwrap();
    db.pragma_update(None, "user_version", schema).unwrap();
    let mut data: Value =
        serde_json::from_str(include_str!("fixtures/first-beta-state.json")).unwrap();
    let mut jobs: Vec<Job> = serde_json::from_value(data["jobs"].take()).unwrap();
    for job in &mut jobs {
        job.destination = folder.path().join(&job.destination);
        db.execute(
            "INSERT INTO jobs VALUES(?1, ?2)",
            params![job.id, serde_json::to_string(job).unwrap()],
        )
        .unwrap();
    }
    db.execute(
        "INSERT INTO settings VALUES(1, ?1)",
        [data["settings"].to_string()],
    )
    .unwrap();
    let settings = serde_json::from_value(data["settings"].take()).unwrap();
    std::fs::write(
        folder.path().join(format!(".zipzap-{}.part0", jobs[1].id)),
        b"prefix",
    )
    .unwrap();
    std::fs::write(&jobs[2].destination, b"prefix").unwrap();
    (folder, database, db, jobs, settings)
}

fn snapshot(db: &Connection) -> (i64, Vec<(String, String)>, String) {
    let rows = db
        .prepare("SELECT id,data FROM jobs ORDER BY rowid")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    (
        db.pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap(),
        rows,
        db.query_row("SELECT data FROM settings WHERE id=1", [], |r| r.get(0))
            .unwrap(),
    )
}

#[test]
fn first_beta_state_recovers_order_validators_parts_and_settings_on_reopen() {
    for schema in [0, 1, 2] {
        let (folder, database, db, mut jobs, settings) = fixture(schema);
        jobs[1].status = Status::Paused;
        jobs[1].downloaded = 6;
        jobs[1].speed = 0;
        for _ in 0..2 {
            let manager = Manager::open(&database).unwrap();
            assert_eq!(
                serde_json::to_value(manager.jobs()).unwrap(),
                serde_json::to_value(&jobs).unwrap()
            );
            assert_eq!(
                serde_json::to_value(manager.settings()).unwrap(),
                serde_json::to_value(&settings).unwrap()
            );
            assert_eq!(snapshot(&db).0, 2);
            assert_eq!(
                std::fs::read(folder.path().join(format!(".zipzap-{}.part0", jobs[1].id))).unwrap(),
                b"prefix"
            );
            assert_eq!(std::fs::read(&jobs[2].destination).unwrap(), b"prefix");
        }
    }
}

#[test]
fn failed_recovery_rolls_back_every_row_and_schema_then_retries() {
    for schema in [0, 1] {
        let (folder, database, db, jobs, _) = fixture(schema);
        db.execute_batch(&format!("CREATE TRIGGER reject_migration BEFORE UPDATE ON jobs WHEN OLD.id='{}' BEGIN SELECT RAISE(ABORT, 'injected migration failure'); END;", jobs[2].id)).unwrap();
        let before = snapshot(&db);
        let error = Manager::open(&database).err().unwrap();
        assert!(error.contains("injected migration failure"), "{error}");
        assert_eq!(snapshot(&db), before);
        assert_eq!(
            std::fs::read(folder.path().join(format!(".zipzap-{}.part0", jobs[1].id))).unwrap(),
            b"prefix"
        );
        assert_eq!(std::fs::read(&jobs[2].destination).unwrap(), b"prefix");
        db.execute_batch("DROP TRIGGER reject_migration;").unwrap();
        let manager = Manager::open(&database).unwrap();
        assert_eq!(manager.jobs()[1].status, Status::Paused);
        assert_eq!(manager.jobs()[1].segments[0].done, 6);
    }
}

#[test]
fn malformed_records_leave_original_data_and_schema_recoverable() {
    for (table, value) in [
        ("jobs", "{broken".to_owned()),
        ("settings", "{broken".to_owned()),
        (
            "settings",
            json!({"max_concurrent":0,"connections":99,"speed_limit":0,"language":"ar"})
                .to_string(),
        ),
    ] {
        let (_folder, database, db, _, _) = fixture(0);
        db.execute(&format!("UPDATE {table} SET data=?1"), [value])
            .unwrap();
        let before = snapshot(&db);
        assert!(Manager::open(&database).is_err());
        assert_eq!(snapshot(&db), before);
    }
}

#[test]
fn mismatched_identity_and_overflowing_prefix_are_rejected_without_writes() {
    for overflow in [false, true] {
        let (_folder, database, db, jobs, _) = fixture(0);
        let mut job = serde_json::to_value(&jobs[1]).unwrap();
        if overflow {
            job["segments"] = json!([
                {"start":0,"end":null,"done":u64::MAX,"hash":""},
                {"start":0,"end":null,"done":1,"hash":""}
            ]);
        } else {
            job["id"] = json!("00000000-0000-4000-8000-000000000004");
        }
        db.execute(
            "UPDATE jobs SET data=?1 WHERE id=?2",
            params![job.to_string(), jobs[1].id],
        )
        .unwrap();
        let before = snapshot(&db);
        assert!(Manager::open(&database).is_err());
        assert_eq!(snapshot(&db), before);
    }
}

#[test]
fn newer_schema_is_rejected_before_journal_or_record_changes() {
    let (_folder, database, db, _, _) = fixture(3);
    let before = snapshot(&db);
    assert_eq!(
        db.pragma_query_value(None, "journal_mode", |r| r.get::<_, String>(0))
            .unwrap(),
        "delete"
    );
    drop(db);
    let bytes = std::fs::read(&database).unwrap();
    assert!(
        Manager::open(&database)
            .err()
            .unwrap()
            .contains("newer ZipZap")
    );
    assert!(
        std::fs::read(&database).unwrap() == bytes,
        "database bytes changed"
    );
    assert_eq!(snapshot(&Connection::open(database).unwrap()), before);
}

#[test]
fn malformed_publication_evidence_rolls_back_the_schema_upgrade() {
    for invalid in ["digest", "destination"] {
        let (_folder, database, db, jobs, _) = fixture(1);
        let mut job = serde_json::to_value(&jobs[2]).unwrap();
        job["publication"] = json!({
            "bytes": 6, "sha256": jobs[2].segments[0].hash, "identity": {"volume": 0, "index": vec![0u8; 16]}
        });
        if invalid == "digest" {
            job["publication"]["sha256"] = json!("invalid");
        } else {
            job["destination"] = json!("");
        }
        db.execute(
            "UPDATE jobs SET data=?1 WHERE id=?2",
            params![job.to_string(), jobs[2].id],
        )
        .unwrap();
        let before = snapshot(&db);
        assert!(
            Manager::open(&database)
                .err()
                .unwrap()
                .contains("Invalid saved publication evidence")
        );
        assert_eq!(snapshot(&db), before);
    }
}

#[test]
fn saved_backoff_reopens_paused_without_restarting_a_retry_deadline() {
    let (_folder, database, db, jobs, _) = fixture(2);
    let mut job = serde_json::to_value(&jobs[1]).unwrap();
    job["attempt"] = json!(2);
    job["next_retry"] = json!(u64::MAX);
    job["failure_reason"] = json!("network");
    db.execute(
        "UPDATE jobs SET data=?1 WHERE id=?2",
        params![job.to_string(), jobs[1].id],
    )
    .unwrap();
    for _ in 0..2 {
        let manager = Manager::open(&database).unwrap();
        let recovered = &manager.jobs()[1];
        assert_eq!(recovered.status, Status::Paused);
        assert_eq!(recovered.attempt, 2);
        assert_eq!(recovered.next_retry, None);
        assert_eq!(
            recovered.failure_reason,
            Some(zipzap_core::FailureReason::Network)
        );
        assert_eq!(manager.jobs()[0].attempt, 0);
        assert_eq!(manager.jobs()[0].failure_reason, None);
    }
}

#[test]
fn interrupted_upgrade_child_process() {
    let Some(database) = std::env::var_os("ZIPZAP_MIGRATION_CRASH_DB") else {
        return;
    };
    let database = PathBuf::from(database);
    let db = Connection::open(&database).unwrap();
    db.execute_batch(
        "BEGIN IMMEDIATE; DELETE FROM jobs; UPDATE settings SET data='{}'; PRAGMA user_version=99;",
    )
    .unwrap();
    std::fs::write(database.with_extension("ready"), b"uncommitted").unwrap();
    loop {
        std::thread::park();
    }
}

#[test]
fn killed_uncommitted_upgrade_reopens_the_prior_committed_state() {
    for journal in ["delete", "wal"] {
        let (_folder, database, db, mut jobs, settings) = fixture(0);
        db.pragma_update(None, "journal_mode", journal).unwrap();
        drop(db);
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "interrupted_upgrade_child_process"])
            .env("ZIPZAP_MIGRATION_CRASH_DB", &database)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let ready = database.with_extension("ready");
        while !ready.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        let _ = child.kill();
        child.wait().unwrap();
        assert!(ready.exists(), "child did not start the transaction");
        let manager = Manager::open(&database).unwrap();
        jobs[1].status = Status::Paused;
        jobs[1].downloaded = 6;
        jobs[1].speed = 0;
        assert_eq!(
            serde_json::to_value(manager.jobs()).unwrap(),
            serde_json::to_value(jobs).unwrap()
        );
        assert_eq!(
            serde_json::to_value(manager.settings()).unwrap(),
            serde_json::to_value(settings).unwrap()
        );
    }
}

#[test]
fn unavailable_saved_folder_does_not_block_recovery_or_get_reset() {
    let (folder, database, db, _, mut settings) = fixture(1);
    settings.download_folder = Some(folder.path().join("offline-drive").to_str().unwrap().into());
    db.execute(
        "UPDATE settings SET data=?1",
        [serde_json::to_string(&settings).unwrap()],
    )
    .unwrap();
    let before = snapshot(&db).2;
    let manager = Manager::open(&database).unwrap();
    assert_eq!(manager.settings().download_folder, settings.download_folder);
    assert_eq!(snapshot(&db).2, before);
    assert!(manager.set_settings(settings).is_err());
    assert_eq!(snapshot(&db).2, before);
}

#[test]
fn failed_initialization_rolls_back_table_creation() {
    let folder = tempfile::tempdir().unwrap();
    let database = folder.path().join("state.sqlite");
    let db = Connection::open(&database).unwrap();
    db.execute_batch("CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL); INSERT INTO settings VALUES(1, '{broken');").unwrap();
    assert!(Manager::open(&database).is_err());
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='jobs'",
            [],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("SELECT data FROM settings", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "{broken"
    );
}
