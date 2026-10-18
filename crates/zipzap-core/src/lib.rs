//! Download state, integrity, durable checkpoints, and one bounded queue.
#[cfg(test)]
mod persistence_tests;
mod publication;
#[cfg(test)]
mod publication_tests;
mod transfer;

use reqwest::{Client, Url};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Queued,
    Downloading,
    Paused,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Segment {
    pub start: u64,
    pub end: Option<u64>,
    pub done: u64,
    pub hash: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct FileIdentity {
    pub volume: u64,
    pub index: [u8; 16],
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct Publication {
    pub bytes: u64,
    pub sha256: String,
    pub identity: FileIdentity,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Job {
    pub id: String,
    pub url: String,
    pub destination: PathBuf,
    pub status: Status,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub speed: u64,
    pub error: Option<String>,
    pub segments: Vec<Segment>,
    pub validator: Option<String>,
    pub effective_url: Option<String>,
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publication: Option<Publication>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Settings {
    pub max_concurrent: usize,
    pub connections: usize,
    pub speed_limit: u64,
    pub language: String,
    #[serde(default)]
    pub download_folder: Option<String>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            max_concurrent: 2,
            connections: 2,
            speed_limit: 0,
            language: "en".into(),
            download_folder: None,
        }
    }
}
impl Settings {
    fn validate(&self) -> Result<()> {
        if !(1..=4).contains(&self.max_concurrent)
            || !(1..=4).contains(&self.connections)
            || self.speed_limit > 10_000_000_000
            || !["en", "ar"].contains(&self.language.as_str())
            || self
                .download_folder
                .as_ref()
                .is_some_and(|p| p.len() > 32768 || !Path::new(p).is_absolute())
        {
            return Err("Invalid queue settings".into());
        }
        Ok(())
    }
}

struct State {
    db: Connection,
    jobs: Vec<Job>,
    running: HashMap<String, CancellationToken>,
    settings: Settings,
    samples: HashMap<String, (Instant, u64)>,
}
pub struct Manager {
    state: Mutex<State>,
    client: Client,
    stop: CancellationToken,
    limiter: Mutex<Instant>,
    limit_changed: tokio::sync::Notify,
    _owner: std::fs::File,
    hosts: Mutex<HashMap<String, Arc<tokio::sync::Semaphore>>>,
}

pub fn validate_url(value: &str) -> Result<Url> {
    if value.len() > 16384 {
        return Err("URL is too long".into());
    }
    let url = Url::parse(value).map_err(|_| "Enter a valid HTTP or HTTPS URL")?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only HTTP/HTTPS URLs without embedded credentials are supported".into());
    }
    Ok(url)
}

pub fn validate_filename(value: &str) -> Result<()> {
    let stem = value
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    if value.is_empty()
        || value.len() > 180
        || value.trim() != value
        || value.ends_with('.')
        || value
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || ["CON", "PRN", "AUX", "NUL", "CLOCK$", "CONIN$", "CONOUT$"].contains(&stem.as_str())
        || (["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        }))
    {
        return Err("Choose a plain filename without reserved names or path characters".into());
    }
    Ok(())
}

impl Manager {
    pub fn open(database: &Path) -> Result<Arc<Self>> {
        Self::open_with_ca(database, None)
    }

    /// Add an explicitly trusted certificate without disabling peer verification.
    pub fn open_with_ca(
        database: &Path,
        certificate: Option<reqwest::Certificate>,
    ) -> Result<Arc<Self>> {
        if let Some(parent) = database.parent() {
            std::fs::create_dir_all(parent).map_err(io_error)?;
        }
        let owner = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(database.with_extension("sqlite.lock"))
            .map_err(io_error)?;
        owner
            .try_lock()
            .map_err(|_| "Another ZipZap process already owns this database")?;
        let mut db = Connection::open(database).map_err(db_error)?;
        let schema: i64 = db
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(db_error)?;
        if schema > 2 {
            return Err("Database was created by a newer ZipZap version".into());
        }
        db.pragma_update(None, "journal_mode", "WAL")
            .map_err(db_error)?;
        db.pragma_update(None, "synchronous", "FULL")
            .map_err(db_error)?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(db_error)?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);").map_err(db_error)?;
        let mut jobs = Vec::new();
        {
            let mut statement = tx
                .prepare("SELECT id,data FROM jobs ORDER BY rowid")
                .map_err(db_error)?;
            for row in statement
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(db_error)?
            {
                let (id, data) = row.map_err(db_error)?;
                let mut job: Job = serde_json::from_str(&data)
                    .map_err(|_| "Invalid saved job; database retained for recovery")?;
                let uuid = Uuid::parse_str(&job.id).map_err(|_| "Invalid saved job identity")?;
                if uuid.to_string() != job.id
                    || id != job.id
                    || job.segments.len() > 4
                    || job.segments.iter().any(|s| {
                        s.end.is_some_and(|end| {
                            end.checked_sub(s.start)
                                .and_then(|v| v.checked_add(1))
                                .is_none_or(|length| s.done > length)
                        })
                    })
                {
                    return Err("Invalid saved checkpoint; database retained for recovery".into());
                }
                validate_url(&job.url)?;
                if job.status == Status::Downloading {
                    job.status = Status::Paused;
                }
                job.speed = 0;
                job.downloaded = job
                    .segments
                    .iter()
                    .try_fold(0u64, |total, segment| total.checked_add(segment.done))
                    .ok_or("Invalid saved checkpoint; database retained for recovery")?;
                if job.publication.as_ref().is_some_and(|p| {
                    !job.destination.is_absolute()
                        || job.destination.file_name().is_none()
                        || p.bytes != job.downloaded
                        || job.total.is_some_and(|t| t != p.bytes)
                        || job.segments.is_empty()
                        || p.sha256.len() != 64
                        || !p
                            .sha256
                            .bytes()
                            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                }) {
                    return Err(
                        "Invalid saved publication evidence; database retained for recovery".into(),
                    );
                }
                jobs.push(job);
            }
        }
        let settings: Settings =
            match tx.query_row("SELECT data FROM settings WHERE id=1", [], |r| {
                r.get::<_, String>(0)
            }) {
                Ok(value) => serde_json::from_str(&value).map_err(|_| "Invalid saved settings")?,
                Err(rusqlite::Error::QueryReturnedNoRows) => Settings::default(),
                Err(error) => return Err(db_error(error)),
            };
        settings
            .validate()
            .map_err(|_| "Invalid saved settings; database retained for recovery")?;
        let client = Client::builder()
            .user_agent("ZipZap/0.1.0-beta.1")
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(30))
            .referer(false)
            .redirect(reqwest::redirect::Policy::none());
        let client = if let Some(certificate) = certificate {
            client.add_root_certificate(certificate)
        } else {
            client
        };
        let client = client.build().map_err(network_error)?;
        let mut publication_guards = Vec::new();
        for job in &mut jobs {
            match publication::recover(job) {
                Ok(Some(guards)) => publication_guards.push(guards),
                Ok(None) => {}
                Err(error) => {
                    job.status = Status::Failed;
                    job.error = Some(error);
                }
            }
        }
        // Recovery and the schema marker become durable together before workers can start.
        for job in &jobs {
            tx.execute(
                "UPDATE jobs SET data=?1 WHERE id=?2",
                params![serde_json::to_string(job).map_err(json_error)?, job.id],
            )
            .map_err(db_error)?;
        }
        tx.pragma_update(None, "user_version", 2)
            .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        drop(publication_guards);
        for job in &jobs {
            publication::cleanup(job);
        }
        Ok(Arc::new(Self {
            state: Mutex::new(State {
                db,
                jobs,
                running: HashMap::new(),
                settings,
                samples: HashMap::new(),
            }),
            client,
            stop: CancellationToken::new(),
            limiter: Mutex::new(Instant::now()),
            limit_changed: tokio::sync::Notify::new(),
            _owner: owner,
            hosts: Mutex::new(HashMap::new()),
        }))
    }

    pub fn jobs(&self) -> Vec<Job> {
        self.state.lock().expect("state lock").jobs.clone()
    }
    pub fn settings(&self) -> Settings {
        self.state.lock().expect("state lock").settings.clone()
    }
    pub fn set_settings(&self, settings: Settings) -> Result<()> {
        settings.validate()?;
        if settings
            .download_folder
            .as_ref()
            .is_some_and(|p| !Path::new(p).is_dir())
        {
            return Err("Invalid queue settings".into());
        }
        let mut state = self.state.lock().expect("state lock");
        state
            .db
            .execute(
                "INSERT OR REPLACE INTO settings VALUES(1, ?1)",
                [serde_json::to_string(&settings).map_err(json_error)?],
            )
            .map_err(db_error)?;
        state.settings = settings;
        *self.limiter.lock().expect("rate lock") = Instant::now();
        self.limit_changed.notify_waiters();
        Ok(())
    }

    pub fn add(&self, value: &str, folder: &Path, filename: Option<&str>) -> Result<Job> {
        self.add_with_id(value, folder, filename, &Uuid::new_v4().to_string())
    }

    /// A stable request ID makes native inbox replay idempotent across crashes.
    pub fn add_with_id(
        &self,
        value: &str,
        folder: &Path,
        filename: Option<&str>,
        id: &str,
    ) -> Result<Job> {
        if Uuid::parse_str(id)
            .map_err(|_| "Invalid request ID")?
            .to_string()
            != id
        {
            return Err("Invalid request ID".into());
        }
        if let Some(job) = self.jobs().into_iter().find(|j| j.id == id) {
            return Ok(job);
        }
        let url = validate_url(value)?;
        let suggested = url
            .path_segments()
            .and_then(|mut p| p.next_back())
            .filter(|s| validate_filename(s).is_ok())
            .unwrap_or("download.bin");
        let name = filename.unwrap_or(suggested);
        validate_filename(name)?;
        let folder = folder.canonicalize().map_err(io_error)?;
        if !folder.is_dir() {
            return Err("Destination must be an existing folder".into());
        }
        let destination = folder.join(name);
        if destination.symlink_metadata().is_ok() {
            return Err("Destination already exists; choose another filename".into());
        }
        let mut state = self.state.lock().expect("state lock");
        if state.jobs.len() >= 1000 {
            return Err("Queue history limit reached; remove old completed downloads".into());
        }
        if state.jobs.iter().any(|j| {
            j.destination.to_string_lossy().to_lowercase()
                == destination.to_string_lossy().to_lowercase()
                && ![Status::Cancelled, Status::Failed].contains(&j.status)
        }) {
            return Err("That destination is already in the queue".into());
        }
        let job = Job {
            id: id.to_owned(),
            url: url.to_string(),
            destination,
            status: Status::Queued,
            downloaded: 0,
            total: None,
            speed: 0,
            error: None,
            segments: vec![],
            validator: None,
            effective_url: None,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            publication: None,
        };
        state
            .db
            .execute(
                "INSERT INTO jobs VALUES(?1, ?2)",
                params![job.id, serde_json::to_string(&job).map_err(json_error)?],
            )
            .map_err(db_error)?;
        state.jobs.push(job.clone());
        Ok(job)
    }

    pub fn action(&self, id: &str, action: &str) -> Result<()> {
        let mut state = self.state.lock().expect("state lock");
        let index = state
            .jobs
            .iter()
            .position(|j| j.id == id)
            .ok_or("Download not found")?;
        let status = state.jobs[index].status.clone();
        let mut job = state.jobs[index].clone();
        match action {
            "pause" if [Status::Queued, Status::Downloading].contains(&status) => {
                job.status = Status::Paused;
            }
            "resume" if [Status::Paused, Status::Failed].contains(&status) => {
                // The scheduler waits for the previous worker to exit before restarting.
                job.status = Status::Queued;
                job.error = None;
            }
            "cancel" if status != Status::Completed => {
                job.status = Status::Cancelled;
            }
            "remove"
                if !state.running.contains_key(id)
                    && [Status::Completed, Status::Cancelled, Status::Failed].contains(&status) =>
            {
                state
                    .db
                    .execute("DELETE FROM jobs WHERE id=?1", [id])
                    .map_err(db_error)?;
                let job = state.jobs.remove(index);
                drop(state);
                transfer::cleanup(&job);
                return Ok(());
            }
            _ => return Err("Action is not available for this download state".into()),
        }
        job.speed = 0;
        save(&state, &job)?;
        state.jobs[index] = job.clone();
        if [Status::Paused, Status::Cancelled].contains(&job.status)
            && let Some(token) = state.running.get(id)
        {
            token.cancel();
        }
        let clean = job.status == Status::Cancelled && !state.running.contains_key(id);
        drop(state);
        if clean {
            transfer::cleanup(&job);
        }
        Ok(())
    }

    pub fn start(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                if manager.stop.is_cancelled() {
                    break;
                }
                let pending = {
                    let mut state = manager.state.lock().expect("state lock");
                    let mut pending = Vec::new();
                    let mut hosts: HashMap<String, usize> = HashMap::new();
                    for job in &state.jobs {
                        if state.running.contains_key(&job.id) {
                            *hosts.entry(host(&job.url)).or_default() += 1;
                        }
                    }
                    let capacity = state
                        .settings
                        .max_concurrent
                        .saturating_sub(state.running.len());
                    for index in 0..state.jobs.len() {
                        if pending.len() >= capacity {
                            break;
                        }
                        let job = &state.jobs[index];
                        let h = host(&job.url);
                        if job.status != Status::Queued
                            || state.running.contains_key(&job.id)
                            || hosts.get(&h).copied().unwrap_or(0) >= 2
                        {
                            continue;
                        }
                        let mut job = job.clone();
                        job.status = Status::Downloading;
                        if let Err(error) = save(&state, &job) {
                            state.jobs[index].status = Status::Failed;
                            state.jobs[index].speed = 0;
                            state.jobs[index].error = Some(unsaved_error(error));
                            continue;
                        }
                        state.jobs[index] = job;
                        let token = manager.stop.child_token();
                        let id = state.jobs[index].id.clone();
                        state.running.insert(id.clone(), token.clone());
                        pending.push((id, token));
                        *hosts.entry(h).or_default() += 1;
                    }
                    pending
                };
                for (id, token) in pending {
                    let m = Arc::clone(&manager);
                    tokio::spawn(async move {
                        m.worker(&id, token).await;
                    });
                }
                tokio::select! { _ = manager.stop.cancelled() => break, _ = tokio::time::sleep(Duration::from_millis(100)) => {} }
            }
        });
    }

    async fn worker(self: &Arc<Self>, id: &str, token: CancellationToken) {
        let mut failure = None;
        let mut single = false;
        for attempt in 0..3 {
            if token.is_cancelled() {
                break;
            }
            match transfer::download(Arc::clone(self), id, &token, single).await {
                Ok(()) => {
                    failure = None;
                    break;
                }
                Err(error) => {
                    let storage_failed = error.starts_with("State database error:");
                    if error.starts_with("Range rejected") {
                        single = true;
                    }
                    failure = Some(error);
                    if token.is_cancelled()
                        || storage_failed
                        || failure
                            .as_ref()
                            .is_some_and(|e| e.starts_with("Published file conflict:"))
                    {
                        break;
                    }
                    tokio::select! { _ = token.cancelled() => break, _ = tokio::time::sleep(Duration::from_millis(500 * (1 << attempt))) => {} }
                }
            }
        }
        let mut state = self.state.lock().expect("state lock");
        if let Some(index) = state.jobs.iter().position(|j| j.id == id) {
            let mut job = state.jobs[index].clone();
            if job.status == Status::Downloading {
                job.speed = 0;
                job.status = if token.is_cancelled() {
                    Status::Paused
                } else if failure.is_some() {
                    Status::Failed
                } else {
                    Status::Completed
                };
                job.error = if token.is_cancelled() { None } else { failure };
                if let Err(error) = save(&state, &job) {
                    // This live failure is not durable; retain the last saved checkpoint.
                    job.status = Status::Failed;
                    job.error = Some(unsaved_error(error));
                }
                state.jobs[index] = job.clone();
            }
            if job.status == Status::Cancelled {
                transfer::cleanup(&job);
            }
        }
        state.running.remove(id);
    }

    pub async fn shutdown(&self) {
        self.stop.cancel();
        for _ in 0..100 {
            if self.state.lock().expect("state lock").running.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    fn job(&self, id: &str) -> Result<Job> {
        self.jobs()
            .into_iter()
            .find(|j| j.id == id)
            .ok_or_else(|| "Download not found".into())
    }
    fn update(&self, id: &str, action: impl FnOnce(&mut Job)) -> Result<()> {
        let mut state = self.state.lock().expect("state lock");
        let index = state
            .jobs
            .iter()
            .position(|j| j.id == id)
            .ok_or("Download not found")?;
        let mut job = state.jobs[index].clone();
        action(&mut job);
        save(&state, &job)?;
        state.jobs[index] = job;
        Ok(())
    }
    fn progress(&self, id: &str, count: u64) {
        let mut state = self.state.lock().expect("state lock");
        let State { jobs, samples, .. } = &mut *state;
        if let Some(job) = jobs.iter_mut().find(|j| j.id == id) {
            let now = Instant::now();
            let (start, previous) = samples
                .entry(id.to_owned())
                .or_insert((now, job.downloaded));
            job.downloaded += count;
            if now.duration_since(*start) >= Duration::from_millis(100) {
                job.speed = ((job.downloaded.saturating_sub(*previous)) as f64
                    / now.duration_since(*start).as_secs_f64()) as u64;
                if now.duration_since(*start) >= Duration::from_secs(1) {
                    *start = now;
                    *previous = job.downloaded;
                }
            }
        }
    }
    async fn throttle(&self, bytes: usize, token: &CancellationToken) -> Result<()> {
        let limit = self.settings().speed_limit;
        if limit == 0 {
            return Ok(());
        }
        let wait = {
            let mut next = self.limiter.lock().expect("rate lock");
            let now = Instant::now();
            let start = (*next).max(now);
            *next = start + Duration::from_secs_f64(bytes as f64 / limit as f64);
            start.saturating_duration_since(now)
        };
        tokio::select! { _ = token.cancelled() => Err("Paused".into()), _ = tokio::time::sleep(wait) => Ok(()), _ = self.limit_changed.notified() => Ok(()) }
    }

    async fn send(
        &self,
        builder: reqwest::RequestBuilder,
        token: &CancellationToken,
    ) -> Result<(reqwest::Response, tokio::sync::OwnedSemaphorePermit)> {
        let mut request = builder.build().map_err(network_error)?;
        for _ in 0..=10 {
            let slots = self.host_slots(request.url().as_str());
            let permit = tokio::select! { _ = token.cancelled() => return Err("Paused".into()), p = slots.acquire_owned() => p.map_err(|_| "Host queue closed")? };
            let response = tokio::select! { _ = token.cancelled() => return Err("Paused".into()), r = self.client.execute(request.try_clone().ok_or("Request cannot be replayed")?) => r.map_err(network_error)? };
            if ![301, 302, 303, 307, 308].contains(&response.status().as_u16()) {
                return Ok((response, permit));
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("Invalid redirect location")?;
            let next = response
                .url()
                .join(location)
                .map_err(|_| "Invalid redirect location")?;
            validate_url(next.as_str())?;
            if request.url().scheme() == "https" && next.scheme() != "https" {
                return Err("HTTPS downgrade redirect rejected".into());
            }
            *request.url_mut() = next;
        }
        Err("Redirect limit reached".into())
    }
    fn host_slots(&self, url: &str) -> Arc<tokio::sync::Semaphore> {
        self.hosts
            .lock()
            .expect("host lock")
            .entry(host(url))
            .or_insert_with(|| Arc::new(tokio::sync::Semaphore::new(4)))
            .clone()
    }
}

fn host(value: &str) -> String {
    Url::parse(value)
        .map(|u| {
            format!(
                "{}:{}",
                u.host_str().unwrap_or(""),
                u.port_or_known_default().unwrap_or(0)
            )
        })
        .unwrap_or_default()
}
fn save(state: &State, job: &Job) -> Result<()> {
    state
        .db
        .execute(
            "UPDATE jobs SET data=?1 WHERE id=?2",
            params![serde_json::to_string(job).map_err(json_error)?, job.id],
        )
        .map_err(db_error)?;
    Ok(())
}
fn io_error(error: std::io::Error) -> String {
    format!("File operation failed: {error}")
}
fn db_error(error: rusqlite::Error) -> String {
    format!("State database error: {error}")
}
fn unsaved_error(error: String) -> String {
    format!(
        "Could not save download state; last saved state retained. Repair storage and retry: {error}"
    )
}
fn json_error(_: serde_json::Error) -> String {
    "Invalid state document".into()
}
fn network_error(error: reqwest::Error) -> String {
    format!("Network request failed: {}", error.without_url())
}
