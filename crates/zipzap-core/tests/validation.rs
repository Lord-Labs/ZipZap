use zipzap_core::{Manager, validate_filename, validate_url};

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
