use zipzap_core::{Manager, Status, validate_filename, validate_url};

#[test]
fn rejects_unsafe_names_and_urls() {
    for name in [
        "",
        "..",
        "../escape",
        "CON.txt",
        "LPT1",
        "COM¹.txt",
        "LPT².bin",
        "CON .txt",
        "name.",
        " name",
        "a:b",
        "a\\b",
        "a\n.exe",
    ] {
        assert!(validate_filename(name).is_err(), "accepted {name:?}");
    }
    assert!(validate_filename("عربي-archive.zip").is_ok());
    for url in [
        "file:///etc/passwd",
        "ftp://example.com/a",
        "http://u:p@example.com/a",
        "https://",
        "not a URL",
    ] {
        assert!(validate_url(url).is_err());
    }
    assert!(validate_url("https://example.com/a?token=private").is_ok());
}

#[test]
fn persistent_queue_and_no_clobber_validation() {
    let folder = tempfile::tempdir().unwrap();
    let db = folder.path().join("state.sqlite");
    let m = Manager::open(&db).unwrap();
    let job = m
        .add("https://example.com/file.bin", folder.path(), None)
        .unwrap();
    assert!(
        m.add("https://example.com/file.bin", folder.path(), None)
            .is_err()
    );
    m.action(&job.id, "pause").unwrap();
    drop(m);
    let m = Manager::open(&db).unwrap();
    assert_eq!(m.jobs()[0].status, zipzap_core::Status::Paused);
    std::fs::write(folder.path().join("occupied.bin"), b"keep").unwrap();
    assert!(
        m.add(
            "https://example.com/file",
            folder.path(),
            Some("occupied.bin")
        )
        .is_err()
    );
    assert_eq!(
        std::fs::read(folder.path().join("occupied.bin")).unwrap(),
        b"keep"
    );
}

#[test]
fn failed_history_deletion_keeps_job_and_files_for_retry() {
    for status in [Status::Completed, Status::Cancelled, Status::Failed] {
        let folder = tempfile::tempdir().unwrap();
        let database = folder.path().join("state.sqlite");
        let manager = Manager::open(&database).unwrap();
        let mut job = manager
            .add("https://example.com/file.bin", folder.path(), None)
            .unwrap();
        drop(manager);
        job.status = status;
        let saved = serde_json::to_string(&job).unwrap();
        let db = rusqlite::Connection::open(&database).unwrap();
        db.execute("UPDATE jobs SET data=?1 WHERE id=?2", (&saved, &job.id))
            .unwrap();
        db.execute_batch(
            "CREATE TRIGGER reject_delete BEFORE DELETE ON jobs
             BEGIN SELECT RAISE(ABORT, 'injected deletion failure'); END;",
        )
        .unwrap();
        std::fs::write(&job.destination, b"keep final file").unwrap();
        let partial = folder.path().join(format!(".zipzap-{}.part0", job.id));
        std::fs::write(&partial, b"keep recoverable data").unwrap();

        let manager = Manager::open(&database).unwrap();
        let error = manager.action(&job.id, "remove").unwrap_err();
        assert!(error.contains("injected deletion failure"), "{error}");
        assert_eq!(
            serde_json::to_value(manager.jobs()).unwrap(),
            serde_json::to_value([&job]).unwrap()
        );
        assert_eq!(
            db.query_row("SELECT data FROM jobs WHERE id=?1", [&job.id], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
            saved
        );
        assert_eq!(std::fs::read(&partial).unwrap(), b"keep recoverable data");
        assert_eq!(std::fs::read(&job.destination).unwrap(), b"keep final file");

        db.execute_batch("DROP TRIGGER reject_delete;").unwrap();
        manager.action(&job.id, "remove").unwrap();
        assert!(manager.jobs().is_empty());
        assert!(!partial.exists());
        assert_eq!(std::fs::read(&job.destination).unwrap(), b"keep final file");
        drop(manager);
        let reopened = Manager::open(&database).unwrap();
        assert!(reopened.jobs().is_empty());
    }
}
