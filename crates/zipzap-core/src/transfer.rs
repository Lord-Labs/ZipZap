use super::retry::{Failure, TransferResult as Result};
use super::*;
use reqwest::{Response, StatusCode, header};
use sha2::{Digest, Sha256};
use tokio::{
    fs::{self, File, OpenOptions},
    io::{AsyncReadExt, AsyncWriteExt},
    task::JoinSet,
};

pub(super) fn part(job: &Job, index: usize) -> PathBuf {
    job.destination
        .parent()
        .expect("validated parent")
        .join(format!(".zipzap-{}.part{index}", job.id))
}
pub(super) fn cleanup(job: &Job) {
    for index in 0..=4 {
        if index == 4 && job.publication.is_some() && !publication::owns_assembly(job) {
            continue;
        }
        let _ = std::fs::remove_file(part(job, index));
    }
}
fn identity(response: &Response) -> Option<String> {
    response
        .headers()
        .get(header::ETAG)?
        .to_str()
        .ok()
        .filter(|s| s.starts_with('"') && s.ends_with('"') && s.len() <= 256)
        .map(str::to_owned)
}
fn encoding_ok(response: &Response) -> bool {
    response
        .headers()
        .get(header::CONTENT_ENCODING)
        .is_none_or(|v| v == "identity")
}
fn bounds(response: &Response, start: u64, end: u64, total: u64) -> bool {
    response.status() == StatusCode::PARTIAL_CONTENT
        && encoding_ok(response)
        && response
            .headers()
            .get(header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            == Some(format!("bytes {start}-{end}/{total}").as_str())
}

pub(super) async fn download(
    manager: Arc<Manager>,
    id: &str,
    token: &CancellationToken,
    single: bool,
) -> Result<()> {
    let mut job = manager.job(id)?;
    let parent = job
        .destination
        .parent()
        .ok_or("Missing destination folder")?;
    if !fs::metadata(parent).await.map_err(io_error)?.is_dir() {
        return Err(io_error(std::io::Error::from(std::io::ErrorKind::NotADirectory)).into());
    }
    if job.publication.is_some() {
        let m = Arc::clone(&manager);
        let id = id.to_owned();
        let token = token.clone();
        return tokio::task::spawn_blocking(move || publication::publish(&m, &id, &token))
            .await
            .map_err(|_| "Publication worker stopped unexpectedly".to_owned())?
            .map_err(Failure::from);
    }
    if job.destination.symlink_metadata().is_ok() {
        return Err("Destination already exists; no file was replaced".into());
    }
    let Probe {
        total,
        validator,
        ranged,
        effective,
    } = probe(&manager, &job.url, token).await?;
    let ranged = ranged && !single;
    let had_saved_bytes = job.segments.iter().any(|segment| segment.done > 0);
    let mut reusable = ranged
        && job.validator == validator
        && job.effective_url.as_ref() == Some(&effective)
        && job.total == total
        && !job.segments.is_empty();
    if reusable {
        for (index, segment) in job.segments.iter().enumerate() {
            match checked_prefix(&part(&job, index), segment).await {
                Ok(_) => {}
                Err(error)
                    if matches!(
                        error.reason,
                        FailureReason::StorageAccess
                            | FailureReason::StorageFull
                            | FailureReason::Storage
                    ) =>
                {
                    return Err(error);
                }
                Err(_) => {
                    reusable = false;
                    break;
                }
            }
        }
    }
    if !reusable {
        let count = if ranged && total.unwrap_or(0) >= 2 * 1024 * 1024 {
            manager.settings().connections as u64
        } else {
            1
        };
        job.segments = (0..count)
            .map(|index| {
                let start = boundary(total.unwrap_or(0), index, count);
                let end = total
                    .filter(|t| *t > 0)
                    .map(|t| boundary(t, index + 1, count) - 1);
                Segment {
                    start,
                    end,
                    done: 0,
                    hash: digest(&Sha256::new()),
                }
            })
            .collect();
    }
    job.downloaded = job.segments.iter().map(|s| s.done).sum();
    job.total = total;
    job.validator = validator;
    job.effective_url = Some(effective);
    manager.update(id, |current| {
        current.segments = job.segments.clone();
        current.downloaded = job.downloaded;
        current.total = job.total;
        current.validator = job.validator.clone();
        current.effective_url = job.effective_url.clone();
        current.recovery_mode = Some(if reusable && had_saved_bytes {
            RecoveryMode::ValidatedResume
        } else if had_saved_bytes || current.recovery_mode == Some(RecoveryMode::SafeRestart) {
            RecoveryMode::SafeRestart
        } else {
            RecoveryMode::Fresh
        });
    })?;
    if !reusable {
        cleanup(&job);
    }
    let mut tasks = JoinSet::new();
    for index in 0..job.segments.len() {
        let m = Arc::clone(&manager);
        let j = job.clone();
        let t = token.clone();
        tasks.spawn(async move { receive(m, &j, index, &t, ranged).await });
    }
    while let Some(result) = tasks.join_next().await {
        let outcome = result
            .map_err(|_| Failure::from("Transfer worker stopped unexpectedly"))
            .and_then(|r| r);
        if let Err(error) = outcome {
            tasks.abort_all();
            while tasks.join_next().await.is_some() {}
            return Err(error);
        }
    }
    if token.is_cancelled() {
        return Err("Paused".into());
    }
    let complete = manager.job(id)?;
    let assembled_path = part(&job, 4);
    let _ = fs::remove_file(&assembled_path).await;
    let mut assembled = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&assembled_path)
        .await
        .map_err(io_error)?;
    for index in 0..job.segments.len() {
        let mut source = File::open(part(&job, index)).await.map_err(io_error)?;
        #[cfg(test)]
        manager.file_failure("assembly", 0)?;
        tokio::io::copy(&mut source, &mut assembled)
            .await
            .map_err(io_error)?;
    }
    assembled.sync_all().await.map_err(io_error)?;
    if complete
        .total
        .is_some_and(|t| t != complete.segments.iter().map(|s| s.done).sum::<u64>())
    {
        return Err("Final byte count does not match the resource".into());
    }
    drop(assembled);
    let id = id.to_owned();
    let token = token.clone();
    tokio::task::spawn_blocking(move || publication::publish(&manager, &id, &token))
        .await
        .map_err(|_| "Publication worker stopped unexpectedly".to_owned())?
        .map_err(Failure::from)
}

pub(super) struct Probe {
    pub total: Option<u64>,
    pub validator: Option<String>,
    pub ranged: bool,
    pub effective: String,
}

pub(super) async fn probe(
    manager: &Manager,
    url: &str,
    token: &CancellationToken,
) -> Result<Probe> {
    let request = manager
        .client
        .get(url)
        .header(header::ACCEPT_ENCODING, "identity")
        .header(header::RANGE, "bytes=0-0");
    let (mut probe, probe_permit) = manager.send(request, token).await?;
    let empty = probe.status() == StatusCode::RANGE_NOT_SATISFIABLE
        && probe
            .headers()
            .get(header::CONTENT_RANGE)
            .is_some_and(|v| v == "bytes */0");
    if !probe.status().is_success() && !empty {
        return Err(Failure::response(&probe));
    }
    if !encoding_ok(&probe) {
        return Err("Unsupported content encoding".into());
    }
    let validator = identity(&probe);
    let total = if empty {
        Some(0)
    } else if probe.status() == StatusCode::PARTIAL_CONTENT {
        probe
            .headers()
            .get(header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("bytes 0-0/"))
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > 0)
    } else {
        probe.content_length()
    };
    let ranged = total.is_some_and(|t| t > 0 && bounds(&probe, 0, 0, t)) && validator.is_some();
    let effective = probe.url().to_string();
    if probe.status() == StatusCode::PARTIAL_CONTENT
        && total.is_some_and(|t| bounds(&probe, 0, 0, t))
    {
        let mut received = 0;
        while let Some(bytes) = tokio::select! { _ = token.cancelled() => return Err("Paused".into()), r = probe.chunk() => r.map_err(network_error)? }
        {
            received += bytes.len();
            if received > 1 {
                return Err("Range rejected: probe body exceeds one byte".into());
            }
        }
        if received != 1 {
            return Err("Range rejected: truncated probe body".into());
        }
    }
    drop(probe);
    drop(probe_permit);
    Ok(Probe {
        total,
        validator,
        ranged,
        effective,
    })
}

async fn checked_prefix(path: &Path, segment: &Segment) -> Result<Sha256> {
    let mut hash = Sha256::new();
    if segment.done == 0 {
        return Ok(hash);
    }
    let metadata = fs::symlink_metadata(path).await.map_err(io_error)?;
    if !metadata.file_type().is_file() || metadata.len() < segment.done {
        return Err("Partial file is missing or truncated".into());
    }
    let mut file = File::open(path).await.map_err(io_error)?;
    let mut remaining = segment.done;
    let mut buffer = [0u8; 65536];
    while remaining > 0 {
        let count = file
            .read(&mut buffer[..remaining.min(65536) as usize])
            .await
            .map_err(io_error)?;
        if count == 0 {
            return Err("Partial file is truncated".into());
        }
        hash.update(&buffer[..count]);
        remaining -= count as u64;
    }
    if digest(&hash) != segment.hash {
        return Err("Partial file checksum changed".into());
    }
    Ok(hash)
}

async fn receive(
    manager: Arc<Manager>,
    job: &Job,
    index: usize,
    token: &CancellationToken,
    ranged: bool,
) -> Result<()> {
    let segment = &job.segments[index];
    let path = part(job, index);
    let mut hash = checked_prefix(&path, segment).await?;
    if segment
        .end
        .is_some_and(|e| segment.done == e - segment.start + 1)
    {
        return Ok(());
    }
    let mut request = manager
        .client
        .get(&job.url)
        .header(header::ACCEPT_ENCODING, "identity");
    if ranged {
        request = request
            .header(
                header::RANGE,
                format!(
                    "bytes={}-{}",
                    segment.start + segment.done,
                    segment.end.ok_or("Missing range length")?
                ),
            )
            .header(
                header::IF_RANGE,
                job.validator.as_deref().ok_or("Missing validator")?,
            );
    }
    let (mut response, _permit) = manager.send(request, token).await?;
    if !response.status().is_success()
        && !(ranged && response.status() == StatusCode::RANGE_NOT_SATISFIABLE)
    {
        return Err(Failure::response(&response));
    }
    if ranged {
        if !bounds(
            &response,
            segment.start + segment.done,
            segment.end.ok_or("Missing range length")?,
            job.total.ok_or("Missing total")?,
        ) || identity(&response) != job.validator
            || Some(response.url().as_str()) != job.effective_url.as_deref()
        {
            return Err("Range rejected: response bounds or resource identity changed".into());
        }
    } else if response.status() != StatusCode::OK {
        return Err(Failure::response(&response));
    } else if !encoding_ok(&response) {
        return Err("Unsupported content encoding".into());
    }
    let expected = if ranged {
        segment.end.map(|e| e - segment.start + 1)
    } else {
        response.content_length()
    };
    if !ranged {
        manager.update(&job.id, |j| {
            j.total = expected;
            j.segments[0].end = expected.filter(|t| *t > 0).map(|t| t - 1);
        })?;
    }
    if path
        .symlink_metadata()
        .is_ok_and(|m| !m.file_type().is_file())
    {
        return Err("Unsafe partial-file path".into());
    }
    let mut file = if !path.exists() {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
            .map_err(io_error)?
    } else {
        OpenOptions::new()
            .write(true)
            .open(&path)
            .await
            .map_err(io_error)?
    };
    file.set_len(segment.done).await.map_err(io_error)?;
    use tokio::io::AsyncSeekExt;
    file.seek(std::io::SeekFrom::Start(segment.done))
        .await
        .map_err(io_error)?;
    let mut done = segment.done;
    let mut checkpoint = done;
    let mut updated = Instant::now();
    loop {
        let next = tokio::select! { _ = token.cancelled() => { checkpoint_file(&manager, job, index, &mut file, done, &hash).await?; return Err("Paused".into()); }, chunk = response.chunk() => chunk.map_err(network_error)? };
        let Some(chunk) = next else {
            break;
        };
        for bytes in chunk.chunks(65536) {
            manager.throttle(bytes.len(), token).await?;
            if expected.is_some_and(|length| done + bytes.len() as u64 > length) {
                return Err("Response exceeds the expected byte count".into());
            }
            #[cfg(test)]
            manager.file_failure("write", done)?;
            file.write_all(bytes).await.map_err(io_error)?;
            hash.update(bytes);
            done += bytes.len() as u64;
            manager.progress(&job.id, bytes.len() as u64);
            if done - checkpoint >= 1024 * 1024 || updated.elapsed() >= Duration::from_secs(1) {
                checkpoint_file(&manager, job, index, &mut file, done, &hash).await?;
                checkpoint = done;
                updated = Instant::now();
            }
        }
    }
    if expected.is_some_and(|length| done != length) {
        return Err("Response ended before the expected byte count".into());
    }
    checkpoint_file(&manager, job, index, &mut file, done, &hash).await
}

async fn checkpoint_file(
    manager: &Manager,
    job: &Job,
    index: usize,
    file: &mut File,
    done: u64,
    hash: &Sha256,
) -> Result<()> {
    #[cfg(test)]
    manager.file_failure("flush", done)?;
    file.flush().await.map_err(io_error)?;
    file.sync_data().await.map_err(io_error)?;
    let digest = digest(hash);
    manager
        .update(&job.id, |j| {
            j.segments[index].done = done;
            j.segments[index].hash = digest;
        })
        .map_err(Failure::from)
}

fn digest(hash: &Sha256) -> String {
    hash.clone()
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn boundary(total: u64, index: u64, count: u64) -> u64 {
    (total / count) * index + (total % count) * index / count
}
