use super::*;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryMode {
    Fresh,
    ValidatedResume,
    SafeRestart,
    PublicationRecovery,
}

impl Manager {
    /// Construct an allowlist rather than trying to redact private job records.
    pub fn support_summary(&self, browser_host_registered: Option<bool>) -> Result<String> {
        let state = self.state.lock().expect("state lock");
        let mut statuses = BTreeMap::<Status, usize>::new();
        let mut failures = BTreeMap::<FailureReason, usize>::new();
        let mut recovery = BTreeMap::<RecoveryMode, usize>::new();
        for job in &state.jobs {
            *statuses.entry(job.status.clone()).or_default() += 1;
            if let Some(reason) = &job.failure_reason {
                *failures.entry(reason.clone()).or_default() += 1;
            }
            if let Some(mode) = job.recovery_mode {
                *recovery.entry(mode).or_default() += 1;
            }
        }
        #[cfg(windows)]
        let os_version = {
            let version = windows_version::OsVersion::current();
            Some([version.major, version.minor, version.build])
        };
        #[cfg(not(windows))]
        let os_version: Option<[u32; 3]> = None;
        let schedule = schedule::snapshot(&state);
        let value = serde_json::json!({
            "format_version": 1,
            "app_version": env!("CARGO_PKG_VERSION"),
            "platform": {"os": std::env::consts::OS, "arch": std::env::consts::ARCH, "version": os_version},
            "counts": {
                "jobs": state.jobs.len(),
                "retry_waits": state.jobs.iter().filter(|job| job.next_retry.is_some()).count(),
                "uncategorized_failures": state.jobs.iter().filter(|job| job.status == Status::Failed && job.failure_reason.is_none()).count(),
                "unknown_recovery": state.jobs.iter().filter(|job| job.recovery_mode.is_none()).count(),
                "provenance_warnings": state.jobs.iter().filter(|job| job.provenance == Some(Provenance::Unavailable)).count(),
            },
            "status_counts": statuses,
            "failure_counts": failures,
            "recovery_counts": recovery,
            "queue": {"running": state.queue_running, "schedule_enabled": schedule.config.is_some(), "schedule_blocked": schedule.error.is_some()},
            "browser_host_registered": browser_host_registered,
            "database_schema": state.db.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0)).map_err(db_error)?,
        });
        let json = serde_json::to_string_pretty(&value)
            .map_err(|_| "Support summary serialization failed")?;
        if json.len() > 8192 {
            return Err("Support summary exceeds the size limit".into());
        }
        Ok(json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_strings_cannot_enter_the_summary_even_with_adversarial_values_and_full_history() {
        let folder = tempfile::tempdir().unwrap();
        let manager = Manager::open(&folder.path().join("state.sqlite")).unwrap();
        let job = manager
            .add("https://example.com/file", folder.path(), None)
            .unwrap();
        manager
            .update(&job.id, |job| {
                job.status = Status::Failed;
                job.failure_reason = Some(FailureReason::Authentication);
                job.recovery_mode = Some(RecoveryMode::SafeRestart);
            })
            .unwrap();
        let before = manager.support_summary(Some(false)).unwrap();
        let private =
            "PRIVATE-user@host cookie=secret Bearer:token %2F%3F\u{202e}عربي".repeat(1000);
        {
            let mut state = manager.state.lock().unwrap();
            let job = &mut state.jobs[0];
            job.id = private.clone();
            job.url = format!("https://{private}/?token={private}#cookie={private}");
            job.destination = PathBuf::from(&private);
            job.error = Some(private.clone());
            job.effective_url = Some(private.clone());
            job.validator = Some(private.clone());
            state.settings.download_folder = Some(private.clone());
            state.settings.categories[0].name = private.clone();
        }
        assert_eq!(manager.support_summary(Some(false)).unwrap(), before);
        {
            let mut state = manager.state.lock().unwrap();
            state.jobs = vec![state.jobs[0].clone(); 1000];
        }
        let summary = manager.support_summary(Some(false)).unwrap();
        assert!(summary.len() < 8192);
        for secret in [
            "PRIVATE", "cookie", "Bearer", "token", "%2F", "عربي", "https://",
        ] {
            assert!(!summary.contains(secret));
        }
        let value: serde_json::Value = serde_json::from_str(&summary).unwrap();
        assert_eq!(value["status_counts"]["failed"], 1000);
        assert_eq!(value["failure_counts"]["authentication"], 1000);
        assert_eq!(value["recovery_counts"]["safe_restart"], 1000);
        assert_eq!(value["browser_host_registered"], false);
        let unknown: serde_json::Value =
            serde_json::from_str(&manager.support_summary(None).unwrap()).unwrap();
        assert!(unknown["browser_host_registered"].is_null());
    }
}
