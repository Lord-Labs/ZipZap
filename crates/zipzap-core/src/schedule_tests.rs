use super::*;

fn instant(value: &str) -> Timestamp {
    value.parse().unwrap()
}
fn zone(name: &str) -> TimeZone {
    TimeZone::get(name).unwrap()
}
fn weekly(days: &[i8], start: u16, stop: u16) -> Schedule {
    Schedule {
        timing: ScheduleTiming::Weekly {
            weekdays: days.to_vec(),
        },
        start_minute: start,
        stop_minute: stop,
    }
}
fn step(manager: &Manager, value: &str, name: &str) {
    tick(
        &mut manager.state.lock().unwrap(),
        instant(value),
        Some(zone(name)),
    );
}
fn setup(config: Schedule, value: &str, name: &str) -> (tempfile::TempDir, Arc<Manager>) {
    let folder = tempfile::tempdir().unwrap();
    let manager = Manager::open(&folder.path().join("state.sqlite")).unwrap();
    manager
        .set_schedule_at(Some(config), instant(value), Some(zone(name)))
        .unwrap();
    (folder, manager)
}

#[test]
fn due_boundaries_commit_once_and_manual_hold_survives_duplicate_ticks_and_restart() {
    let (folder, manager) = setup(weekly(&[1], 600, 660), "2026-10-19T09:59:59Z", "UTC");
    let db = Connection::open(folder.path().join("state.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE transitions(id INTEGER); CREATE TRIGGER count_transition AFTER UPDATE ON schedule BEGIN INSERT INTO transitions VALUES(1); END;").unwrap();
    step(&manager, "2026-10-19T10:00:00Z", "UTC");
    assert!(manager.queue().running);
    step(&manager, "2026-10-19T10:00:00Z", "UTC");
    step(&manager, "2026-10-19T10:00:01Z", "UTC");
    assert_eq!(
        db.query_row("SELECT count(*) FROM transitions", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    manual_gate(
        &mut manager.state.lock().unwrap(),
        false,
        instant("2026-10-19T10:00:01Z").as_second(),
    )
    .unwrap();
    step(&manager, "2026-10-19T10:00:02Z", "UTC");
    assert!(!manager.queue().running);
    let before = manager.state.lock().unwrap().schedule.saved.clone();
    step(&manager, "2026-10-19T09:59:59Z", "UTC");
    step(&manager, "2026-10-19T10:30:00Z", "UTC");
    assert!(!manager.queue().running);
    assert_eq!(manager.state.lock().unwrap().schedule.saved, before);
    drop(manager);
    let manager = Manager::open(&folder.path().join("state.sqlite")).unwrap();
    assert!(!manager.queue().running);
    assert!(manager.queue().schedule.config.is_some());
    assert_eq!(
        manager
            .state
            .lock()
            .unwrap()
            .schedule
            .saved
            .last_start_date
            .as_deref(),
        Some("2026-10-19")
    );
}

#[test]
fn missed_starts_are_skipped_but_due_holds_apply_after_sleep_or_forward_clock_jump() {
    let (_folder, manager) = setup(weekly(&[1], 600, 660), "2026-10-19T09:59:59Z", "UTC");
    step(&manager, "2026-10-19T10:03:00Z", "UTC");
    assert!(!manager.queue().running);
    manual_gate(
        &mut manager.state.lock().unwrap(),
        true,
        instant("2026-10-19T10:04:00Z").as_second(),
    )
    .unwrap();
    step(&manager, "2026-10-19T11:10:00Z", "UTC");
    assert!(!manager.queue().running);
    step(&manager, "2026-10-26T09:59:59Z", "UTC");
    step(&manager, "2026-10-26T10:00:30Z", "UTC");
    assert!(manager.queue().running);
}

#[test]
fn overnight_windows_use_the_start_weekday_and_do_not_unpause_individual_jobs() {
    let (folder, manager) = setup(weekly(&[6], 1380, 60), "2026-10-17T22:59:59Z", "UTC");
    let job = manager
        .add_for_later("https://example.com/file", folder.path(), None)
        .unwrap();
    step(&manager, "2026-10-17T23:00:00Z", "UTC");
    assert!(manager.queue().running);
    assert_eq!(manager.job(&job.id).unwrap().status, Status::Paused);
    step(&manager, "2026-10-18T01:00:00Z", "UTC");
    assert!(!manager.queue().running);
    assert_eq!(manager.job(&job.id).unwrap().status, Status::Paused);
}

#[test]
fn dst_gaps_skip_starts_shift_holds_and_folds_choose_the_first_occurrence() {
    let ny = zone("America/New_York");
    let gap_day = date("2026-03-08").unwrap();
    assert!(weekly(&[7], 150, 240).window(gap_day, &ny).is_none());
    let (start, stop) = weekly(&[7], 90, 150).window(gap_day, &ny).unwrap();
    assert_eq!(start, instant("2026-03-08T06:30:00Z").as_second());
    assert_eq!(stop, instant("2026-03-08T07:30:00Z").as_second());
    let fold_day = date("2026-11-01").unwrap();
    let (start, stop) = weekly(&[7], 90, 105).window(fold_day, &ny).unwrap();
    assert_eq!(start, instant("2026-11-01T05:30:00Z").as_second());
    assert_eq!(stop, instant("2026-11-01T05:45:00Z").as_second());
    let (_folder, manager) = setup(
        weekly(&[7], 90, 105),
        "2026-11-01T05:29:59Z",
        "America/New_York",
    );
    step(&manager, "2026-11-01T05:30:00Z", "America/New_York");
    assert!(manager.queue().running);
    step(&manager, "2026-11-01T05:45:00Z", "America/New_York");
    step(&manager, "2026-11-01T06:29:59Z", "America/New_York");
    step(&manager, "2026-11-01T06:30:00Z", "America/New_York");
    assert!(!manager.queue().running);
}

#[test]
fn zone_changes_hold_dispatch_without_replaying_the_same_local_start_date() {
    let (_folder, manager) = setup(
        weekly(&[1, 2], 600, 660),
        "2026-10-19T13:59:59Z",
        "America/New_York",
    );
    step(&manager, "2026-10-19T14:00:00Z", "America/New_York");
    assert!(manager.queue().running);
    step(&manager, "2026-10-19T14:00:01Z", "America/Los_Angeles");
    assert!(!manager.queue().running);
    step(&manager, "2026-10-19T16:59:59Z", "America/Los_Angeles");
    step(&manager, "2026-10-19T17:00:00Z", "America/Los_Angeles");
    assert!(!manager.queue().running);
    step(&manager, "2026-10-20T16:59:59Z", "America/Los_Angeles");
    step(&manager, "2026-10-20T17:00:00Z", "America/Los_Angeles");
    assert!(manager.queue().running);
}

#[test]
fn failed_transition_rolls_back_gate_and_cursor_blocks_dispatch_and_retries_after_repair() {
    let (folder, manager) = setup(weekly(&[1], 600, 660), "2026-10-19T09:59:59Z", "UTC");
    step(&manager, "2026-10-19T10:00:00Z", "UTC");
    let db = Connection::open(folder.path().join("state.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER reject_schedule BEFORE UPDATE ON schedule BEGIN SELECT RAISE(ABORT, 'injected schedule save'); END;").unwrap();
    let before = manager.state.lock().unwrap().schedule.saved.clone();
    step(&manager, "2026-10-19T11:00:00Z", "UTC");
    let state = manager.state.lock().unwrap();
    assert!(state.queue_running);
    assert!(!allows_dispatch(&state));
    assert_eq!(state.schedule.saved, before);
    assert!(state.schedule.error.is_some());
    drop(state);
    assert_eq!(
        db.query_row("SELECT running FROM queue", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(
        manager
            .set_schedule(None)
            .unwrap_err()
            .contains("injected schedule save")
    );
    db.execute_batch("DROP TRIGGER reject_schedule").unwrap();
    step(&manager, "2026-10-19T11:00:01Z", "UTC");
    assert!(!manager.queue().running);
    assert!(manager.queue().schedule.error.is_none());
}

#[test]
fn one_shot_validation_and_failed_configuration_leave_the_previous_schedule_untouched() {
    let (folder, manager) = setup(weekly(&[1], 600, 660), "2026-10-19T09:59:59Z", "UTC");
    let before = manager.state.lock().unwrap().schedule.saved.clone();
    let once = |value: &str| Schedule {
        timing: ScheduleTiming::Once { date: value.into() },
        start_minute: 600,
        stop_minute: 660,
    };
    for invalid in [
        once("2026-10-18"),
        once("2026-02-30"),
        weekly(&[], 600, 660),
        weekly(&[1, 1], 600, 660),
        weekly(&[8], 600, 660),
        weekly(&[1], 600, 600),
    ] {
        assert!(
            manager
                .set_schedule_at(
                    Some(invalid),
                    instant("2026-10-19T09:59:59Z"),
                    Some(zone("UTC"))
                )
                .is_err()
        );
        assert_eq!(manager.state.lock().unwrap().schedule.saved, before);
    }
    let db = Connection::open(folder.path().join("state.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER reject_schedule BEFORE UPDATE ON schedule BEGIN SELECT RAISE(ABORT, 'injected config save'); END;").unwrap();
    assert!(
        manager
            .set_schedule_at(
                Some(once("2026-10-20")),
                instant("2026-10-19T09:59:59Z"),
                Some(zone("UTC"))
            )
            .is_err()
    );
    assert_eq!(manager.state.lock().unwrap().schedule.saved, before);
    db.execute_batch("DROP TRIGGER reject_schedule").unwrap();
    manager
        .set_schedule_at(
            Some(once("2026-10-20")),
            instant("2026-10-19T09:59:59Z"),
            Some(zone("UTC")),
        )
        .unwrap();
    assert!(!manager.queue().running);
    manager.set_schedule(None).unwrap();
    assert!(!manager.queue().running);
    assert!(manager.queue().schedule.config.is_none());
}

#[test]
fn unavailable_zone_blocks_new_dispatch_and_recovery_is_explicit() {
    let (_folder, manager) = setup(weekly(&[1], 600, 660), "2026-10-19T09:59:59Z", "UTC");
    tick(
        &mut manager.state.lock().unwrap(),
        instant("2026-10-19T10:00:00Z"),
        None,
    );
    assert!(!allows_dispatch(&manager.state.lock().unwrap()));
    step(&manager, "2026-10-19T10:00:01Z", "UTC");
    assert!(allows_dispatch(&manager.state.lock().unwrap()));
    assert!(manager.queue().schedule.error.is_none());
}

#[test]
fn startup_schedule_save_failure_rolls_back_the_hold_and_retains_records_for_repair() {
    let folder = tempfile::tempdir().unwrap();
    let database = folder.path().join("state.sqlite");
    let manager = Manager::open(&database).unwrap();
    manager
        .set_schedule(Some(Schedule {
            timing: ScheduleTiming::Once {
                date: "2099-10-20".into(),
            },
            start_minute: 600,
            stop_minute: 660,
        }))
        .unwrap();
    manager.set_queue_running(true).unwrap();
    drop(manager);
    let db = Connection::open(&database).unwrap();
    let before: String = db
        .query_row("SELECT data FROM schedule", [], |row| row.get(0))
        .unwrap();
    db.execute_batch("CREATE TRIGGER reject_schedule BEFORE UPDATE ON schedule BEGIN SELECT RAISE(ABORT, 'injected startup schedule save'); END;").unwrap();
    assert!(
        Manager::open(&database)
            .err()
            .unwrap()
            .contains("injected startup")
    );
    assert_eq!(
        db.query_row("SELECT running FROM queue", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row("SELECT data FROM schedule", [], |row| row
            .get::<_, String>(0))
            .unwrap(),
        before
    );
    db.execute_batch("DROP TRIGGER reject_schedule").unwrap();
    let reopened = Manager::open(&database).unwrap();
    assert!(!reopened.queue().running);
    assert!(reopened.queue().schedule.next_start.is_some());
    assert_eq!(
        db.query_row("SELECT running FROM queue", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        0
    );
    drop(reopened);
    for raw in [
        "{broken".to_owned(),
        "x".repeat(4097),
        "{\"config\":null,\"processed_through\":-1,\"last_start_date\":null}".into(),
    ] {
        db.execute("UPDATE schedule SET data=?1", [&raw]).unwrap();
        assert!(Manager::open(&database).is_err());
        assert_eq!(
            db.query_row("SELECT data FROM schedule", [], |row| row
                .get::<_, String>(0))
                .unwrap(),
            raw
        );
    }
}

#[test]
fn manual_hold_at_the_start_instant_consumes_the_pending_start() {
    let (_folder, manager) = setup(weekly(&[1], 600, 660), "2026-10-19T09:59:59Z", "UTC");
    manual_gate(
        &mut manager.state.lock().unwrap(),
        false,
        instant("2026-10-19T10:00:00Z").as_second(),
    )
    .unwrap();
    step(&manager, "2026-10-19T10:00:00Z", "UTC");
    step(&manager, "2026-10-19T10:00:01Z", "UTC");
    assert!(!manager.queue().running);
}
