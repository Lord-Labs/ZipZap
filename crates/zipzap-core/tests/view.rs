use zipzap_core::{Manager, Settings};

#[test]
fn view_preferences_persist_without_changing_jobs_and_rejected_values_keep_prior_state() {
    let folder = tempfile::tempdir().unwrap();
    let database = folder.path().join("state.sqlite");
    let manager = Manager::open(&database).unwrap();
    let job = manager
        .add_for_later("https://example.com/a.zip", folder.path(), None)
        .unwrap();
    let mut settings = Settings::default();
    settings.view.appearance = "system".into();
    settings.view.columns[0].width = 440;
    settings.view.columns[5].visible = false;
    settings.view.sort = "filename".into();
    settings.view.descending = true;
    manager.set_settings(settings.clone()).unwrap();
    for invalid in ["appearance", "width", "hidden", "order", "sort"] {
        let mut changed = settings.clone();
        match invalid {
            "appearance" => changed.view.appearance = "custom".into(),
            "width" => changed.view.columns[1].width = 65535,
            "hidden" => changed.view.columns[0].visible = false,
            "order" => changed.view.columns.swap(0, 1),
            _ => changed.view.sort = "url".into(),
        }
        assert!(manager.set_settings(changed).is_err());
        assert_eq!(manager.settings().view, settings.view);
    }
    let db = rusqlite::Connection::open(&database).unwrap();
    db.execute_batch("CREATE TRIGGER reject_view BEFORE INSERT ON settings BEGIN SELECT RAISE(ABORT, 'view save failed'); END;").unwrap();
    let mut changed = settings.clone();
    changed.view.appearance = "light".into();
    assert!(manager.set_settings(changed).is_err());
    assert_eq!(manager.settings().view, settings.view);
    drop(manager);
    let reopened = Manager::open(&database).unwrap();
    assert_eq!(reopened.settings().view, settings.view);
    assert_eq!(reopened.jobs()[0].destination, job.destination);
}
