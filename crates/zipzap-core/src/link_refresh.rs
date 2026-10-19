use super::*;

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LinkReplacement {
    Updated { retained_bytes: u64 },
    RestartRequired,
}

impl Manager {
    pub async fn replace_link(
        &self,
        id: &str,
        value: &str,
        restart: bool,
        token: &CancellationToken,
    ) -> Result<LinkReplacement> {
        let url = validate_url(value)?;
        let previous = {
            let state = self.state.lock().expect("state lock");
            let job = state
                .jobs
                .iter()
                .find(|job| job.id == id)
                .ok_or("Download not found")?;
            if ![Status::Paused, Status::Failed].contains(&job.status)
                || state.running.contains_key(id)
            {
                return Err(
                    "Pause the download and wait for its worker to exit before replacing the link"
                        .into(),
                );
            }
            if job.publication.is_some() {
                return Err(
                    "Repair or finish the pending file publication before replacing the link"
                        .into(),
                );
            }
            job.clone()
        };
        let probe = tokio::select! {
            biased;
            _ = token.cancelled() => return Err("Link replacement cancelled".into()),
            _ = self.stop.cancelled() => return Err("Link replacement cancelled".into()),
            result = tokio::time::timeout(Duration::from_secs(10), transfer::probe(self, url.as_str(), token)) => {
                result.map_err(|_| "Link replacement probe timed out")?.map_err(|failure| failure.message)?
            }
        };
        let mut state = self.state.lock().expect("state lock");
        let index = state
            .jobs
            .iter()
            .position(|job| job.id == id)
            .ok_or("Download not found")?;
        if state.jobs[index] != previous || state.running.contains_key(id) {
            return Err("Download changed while checking the replacement; try again".into());
        }
        if token.is_cancelled() || self.stop.is_cancelled() {
            return Err("Link replacement cancelled".into());
        }
        let saved_bytes = previous.segments.iter().map(|segment| segment.done).sum();
        let same = probe.ranged
            && previous.validator.is_some()
            && previous.validator == probe.validator
            && previous.total == probe.total
            && previous.effective_url.as_deref() == Some(probe.effective.as_str());
        if saved_bytes > 0 && !same && !restart {
            return Ok(LinkReplacement::RestartRequired);
        }
        let retain = same && !restart;
        let mut job = previous.clone();
        job.url = url.to_string();
        job.status = Status::Paused;
        job.speed = 0;
        job.error = None;
        job.failure_reason = None;
        job.attempt = 0;
        job.next_retry = None;
        if !retain {
            job.segments.clear();
            job.downloaded = 0;
            job.total = None;
            job.validator = None;
            job.effective_url = None;
        }
        save(&state, &job)?;
        state.jobs[index] = job;
        if !retain {
            // Commit the explicit restart before discarding owned parts; block concurrent resume.
            transfer::cleanup(&previous);
        }
        Ok(LinkReplacement::Updated {
            retained_bytes: if retain { saved_bytes } else { 0 },
        })
    }
}
