use zipzap_core::{CancellationToken, Category, Manager, Settings, default_categories};

#[test]
fn literal_longest_extension_and_unicode_rules_reject_ambiguity() {
    let folder = tempfile::tempdir().unwrap();
    let manager = Manager::open(&folder.path().join("state.sqlite")).unwrap();
    let mut settings = Settings::default();
    settings.categories.push(Category {
        id: "custom".into(),
        name: "أرشيف خاص".into(),
        extensions: vec!["tar.GZ".into(), "عربي".into()],
        download_folder: None,
    });
    manager.set_settings(settings.clone()).unwrap();
    for (name, expected) in [
        ("archive.TAR.gz", "custom"),
        ("note.عربي", "custom"),
        ("archive.GZ", "compressed"),
        ("report.PDF", "documents"),
        ("unknown.zzz", "other"),
        ("README", "other"),
    ] {
        assert_eq!(manager.settings().category(name).unwrap().id, expected);
    }
    let saved = serde_json::to_value(manager.settings()).unwrap();
    for bad in ["ZIP", "tar..gz", "../zip", "*.zip", "a\u{202e}b", ""] {
        let mut changed = settings.clone();
        changed.categories.last_mut().unwrap().extensions = vec![bad.into()];
        assert!(manager.set_settings(changed).is_err(), "accepted {bad}");
        assert_eq!(serde_json::to_value(manager.settings()).unwrap(), saved);
    }
    settings
        .categories
        .retain(|category| category.id != "other");
    assert!(manager.set_settings(settings).is_err());
}

#[tokio::test]
async fn suggested_folders_respect_explicit_choices_and_offline_rules_without_moving_jobs() {
    let folder = tempfile::tempdir().unwrap();
    let database = folder.path().join("state.sqlite");
    let category_folder = folder.path().join("archives");
    std::fs::create_dir(&category_folder).unwrap();
    let manager = Manager::open(&database).unwrap();
    let job = manager
        .add_for_later("https://example.com/original.zip", folder.path(), None)
        .unwrap();
    std::fs::write(&job.destination, b"keep existing output").unwrap();
    let mut settings = manager.settings();
    settings.categories[0].download_folder = Some(category_folder.to_string_lossy().into());
    manager.set_settings(settings.clone()).unwrap();
    let token = CancellationToken::new();
    let automatic = manager
        .suggest_auto(
            "https://example.com/file",
            folder.path(),
            Some("next.ZIP"),
            &token,
        )
        .await
        .unwrap();
    assert_eq!(
        automatic.destination,
        category_folder.canonicalize().unwrap()
    );
    assert_eq!(automatic.category, "compressed");
    let explicit = manager
        .suggest(
            "https://example.com/file",
            folder.path(),
            Some("next.zip"),
            &token,
        )
        .await
        .unwrap();
    assert_eq!(explicit.destination, folder.path().canonicalize().unwrap());
    std::fs::write(category_folder.join("next.ZIP"), b"occupied").unwrap();
    assert!(
        manager
            .suggest_auto(
                "https://example.com/file",
                folder.path(),
                Some("next.ZIP"),
                &token
            )
            .await
            .unwrap()
            .alternative
            .is_some()
    );
    std::fs::remove_file(category_folder.join("next.ZIP")).unwrap();
    std::fs::remove_dir(&category_folder).unwrap();
    drop(manager);
    let manager = Manager::open(&database).unwrap();
    assert_eq!(manager.settings().categories, settings.categories);
    settings.language = "ar".into();
    manager.set_settings(settings.clone()).unwrap();
    assert!(
        manager
            .suggest_auto(
                "https://example.com/file",
                folder.path(),
                Some("next.zip"),
                &token
            )
            .await
            .unwrap_err()
            .contains("unavailable")
    );
    assert!(
        manager
            .suggest(
                "https://example.com/file",
                folder.path(),
                Some("next.zip"),
                &token
            )
            .await
            .is_ok()
    );
    settings.categories[0].download_folder = Some(
        folder
            .path()
            .join("another-missing")
            .to_string_lossy()
            .into(),
    );
    assert!(manager.set_settings(settings).is_err());
    assert_eq!(manager.jobs()[0].destination, job.destination);
    assert_eq!(
        std::fs::read(&job.destination).unwrap(),
        b"keep existing output"
    );
    let mut restored = manager.settings();
    restored.categories = default_categories();
    manager.set_settings(restored).unwrap();
    assert_eq!(manager.jobs()[0].destination, job.destination);
}

#[test]
fn rejected_settings_save_keeps_rules_and_schema_upgrade_rejects_corruption_atomically() {
    let folder = tempfile::tempdir().unwrap();
    let database = folder.path().join("state.sqlite");
    let manager = Manager::open(&database).unwrap();
    manager
        .set_settings(Settings {
            close_to_tray: true,
            notifications: true,
            ..Settings::default()
        })
        .unwrap();
    let before = manager.settings().categories;
    let db = rusqlite::Connection::open(&database).unwrap();
    db.execute_batch("CREATE TRIGGER reject_rules BEFORE INSERT ON settings BEGIN SELECT RAISE(ABORT, 'rule save failed'); END;").unwrap();
    let mut changed = manager.settings();
    changed.categories[0].name = "Archives".into();
    changed.close_to_tray = false;
    changed.notifications = false;
    assert!(manager.set_settings(changed).is_err());
    assert_eq!(manager.settings().categories, before);
    assert!(manager.settings().close_to_tray);
    assert!(manager.settings().notifications);
    drop(manager);
    db.execute_batch("DROP TRIGGER reject_rules;").unwrap();
    let reopened = Manager::open(&database).unwrap();
    assert_eq!(reopened.settings().categories, before);
    assert!(reopened.settings().close_to_tray);
    assert!(reopened.settings().notifications);
    drop(reopened);
    let mut invalid = serde_json::to_value(Settings::default()).unwrap();
    invalid["categories"][0]["extensions"] = serde_json::json!(["PDF"]);
    let raw = invalid.to_string();
    db.execute("UPDATE settings SET data=?1", [&raw]).unwrap();
    db.pragma_update(None, "user_version", 3).unwrap();
    assert!(Manager::open(&database).is_err());
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    assert_eq!(
        db.query_row("SELECT data FROM settings", [], |r| r.get::<_, String>(0))
            .unwrap(),
        raw
    );
}
