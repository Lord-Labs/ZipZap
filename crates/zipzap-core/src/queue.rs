use super::*;

#[derive(Clone, Serialize, Debug)]
pub struct QueueState {
    pub running: bool,
    pub waiting: Vec<String>,
    pub schedule: ScheduleState,
}

impl Manager {
    pub fn queue(&self) -> QueueState {
        let state = self.state.lock().expect("state lock");
        QueueState {
            running: state.queue_running,
            schedule: schedule::snapshot(&state),
            waiting: state
                .jobs
                .iter()
                .filter(|job| job.status == Status::Queued && !state.running.contains_key(&job.id))
                .map(|job| job.id.clone())
                .collect(),
        }
    }

    pub fn set_queue_running(&self, running: bool) -> Result<()> {
        let mut state = self.state.lock().expect("state lock");
        schedule::manual_gate(&mut state, running, jiff::Timestamp::now().as_second())
    }

    pub fn move_waiting(&self, id: &str, direction: &str) -> Result<()> {
        let step = match direction {
            "up" => -1,
            "down" => 1,
            _ => return Err("Invalid queue movement".into()),
        };
        let mut state = self.state.lock().expect("state lock");
        let waiting: Vec<usize> = state
            .jobs
            .iter()
            .enumerate()
            .filter(|(_, job)| job.status == Status::Queued && !state.running.contains_key(&job.id))
            .map(|(index, _)| index)
            .collect();
        let current = waiting
            .iter()
            .position(|index| state.jobs[*index].id == id)
            .ok_or("Only waiting downloads can move")?;
        let other = current
            .checked_add_signed(step)
            .filter(|index| *index < waiting.len())
            .ok_or("Queue movement is not available")?;
        let (left, right) = (waiting[current], waiting[other]);
        let (mut a, mut b) = (state.jobs[left].clone(), state.jobs[right].clone());
        std::mem::swap(&mut a.queue_order, &mut b.queue_order);
        let tx = state.db.transaction().map_err(db_error)?;
        for job in [&a, &b] {
            tx.execute(
                "UPDATE jobs SET data=?1 WHERE id=?2",
                params![serde_json::to_string(job).map_err(json_error)?, job.id],
            )
            .map_err(db_error)?;
        }
        tx.commit().map_err(db_error)?;
        state.jobs[left] = b;
        state.jobs[right] = a;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_queue_controls_roll_back_before_live_changes_and_reopen_in_order() {
        let folder = tempfile::tempdir().unwrap();
        let database = folder.path().join("state.sqlite");
        let manager = Manager::open(&database).unwrap();
        manager.set_queue_running(false).unwrap();
        let a = manager
            .add("https://example.com/a", folder.path(), None)
            .unwrap();
        let later = manager
            .add_for_later("https://example.com/later", folder.path(), None)
            .unwrap();
        let b = manager
            .add("https://example.com/b", folder.path(), None)
            .unwrap();
        let before = manager.jobs();
        let db = Connection::open(&database).unwrap();
        let durable = |id: &str| {
            db.query_row("SELECT data FROM jobs WHERE id=?1", [id], |row| {
                row.get::<_, String>(0)
            })
            .unwrap()
        };
        let saved = (durable(&a.id), durable(&b.id));
        db.execute_batch(&format!("CREATE TRIGGER reject_second BEFORE UPDATE ON jobs WHEN OLD.id='{}' BEGIN SELECT RAISE(ABORT, 'injected second reorder save'); END;", a.id)).unwrap();
        assert!(
            manager
                .move_waiting(&b.id, "up")
                .unwrap_err()
                .contains("injected second")
        );
        assert_eq!(manager.jobs(), before);
        assert_eq!((durable(&a.id), durable(&b.id)), saved);
        db.execute_batch("DROP TRIGGER reject_second").unwrap();
        manager.move_waiting(&b.id, "up").unwrap();
        assert_eq!(manager.queue().waiting, vec![b.id.clone(), a.id.clone()]);
        assert_eq!(manager.job(&later.id).unwrap().status, Status::Paused);
        assert!(manager.move_waiting(&later.id, "up").is_err());
        db.execute_batch("CREATE TRIGGER reject_hold BEFORE UPDATE ON queue BEGIN SELECT RAISE(ABORT, 'injected queue save'); END;").unwrap();
        assert!(
            manager
                .set_queue_running(true)
                .unwrap_err()
                .contains("injected queue")
        );
        assert!(!manager.queue().running);
        assert_eq!(
            db.query_row("SELECT running FROM queue", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
        db.execute_batch("DROP TRIGGER reject_hold").unwrap();
        manager.set_settings(Settings::default()).unwrap();
        assert!(!manager.queue().running);
        drop(manager);
        let manager = Manager::open(&database).unwrap();
        assert!(!manager.queue().running);
        assert_eq!(manager.queue().waiting, vec![b.id, a.id]);
        let id = Uuid::new_v4().to_string();
        let browser = manager
            .add_with_id("https://example.com/browser", folder.path(), None, &id)
            .unwrap();
        assert_eq!(
            manager
                .add_with_id("https://example.com/browser", folder.path(), None, &id)
                .unwrap(),
            browser
        );
        assert_eq!(manager.queue().waiting.last(), Some(&id));
        manager.set_queue_running(true).unwrap();
        assert_eq!(manager.job(&later.id).unwrap().status, Status::Paused);
    }

    #[test]
    fn reordering_waiting_jobs_preserves_active_worker_positions_and_tokens() {
        let folder = tempfile::tempdir().unwrap();
        let manager = Manager::open(&folder.path().join("state.sqlite")).unwrap();
        let active = manager
            .add("https://example.com/active", folder.path(), None)
            .unwrap();
        let a = manager
            .add("https://example.com/a", folder.path(), None)
            .unwrap();
        let b = manager
            .add("https://example.com/b", folder.path(), None)
            .unwrap();
        let token = CancellationToken::new();
        manager
            .update(&active.id, |job| job.status = Status::Downloading)
            .unwrap();
        manager
            .state
            .lock()
            .unwrap()
            .running
            .insert(active.id.clone(), token.clone());
        manager.move_waiting(&b.id, "up").unwrap();
        assert_eq!(
            manager.jobs().iter().map(|job| &job.id).collect::<Vec<_>>(),
            vec![&active.id, &b.id, &a.id]
        );
        assert!(manager.move_waiting(&active.id, "down").is_err());
        assert!(!token.is_cancelled());
        assert_eq!(
            manager.job(&active.id).unwrap().queue_order,
            active.queue_order
        );
        manager.state.lock().unwrap().running.remove(&active.id);
    }
}
