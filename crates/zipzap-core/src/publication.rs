use super::*;
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read};

fn conflict(reason: &str) -> String {
    format!(
        "Published file conflict: {reason}. Keep existing files; restore the original file/evidence and retry, or add a new download with a free filename"
    )
}

fn open(path: &Path) -> Result<File> {
    if !path
        .symlink_metadata()
        .map_err(io_error)?
        .file_type()
        .is_file()
    {
        return Err("Publication path is not a regular file".into());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        };
        options
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path).map_err(io_error)?;
    if !file.metadata().map_err(io_error)?.file_type().is_file() {
        return Err("Publication path is not a regular file".into());
    }
    Ok(file)
}

fn identity(file: &File) -> Result<FileIdentity> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_ID_INFO, FileIdInfo, GetFileInformationByHandleEx,
        };
        let mut info = FILE_ID_INFO::default();
        // The live handle and correctly sized FILE_ID_INFO buffer outlive the call.
        let ok = unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FileIdInfo,
                (&mut info as *mut FILE_ID_INFO).cast(),
                std::mem::size_of::<FILE_ID_INFO>() as u32,
            )
        };
        if ok == 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        Ok(FileIdentity {
            volume: info.VolumeSerialNumber,
            index: info.FileId.Identifier,
        })
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata().map_err(io_error)?;
        let mut index = [0; 16];
        index[..8].copy_from_slice(&metadata.ino().to_le_bytes());
        Ok(FileIdentity {
            volume: metadata.dev(),
            index,
        })
    }
    #[cfg(not(any(windows, unix)))]
    Err("Publication file identity is unsupported on this platform".into())
}

fn evidence(path: &Path) -> Result<(File, Publication)> {
    let mut file = open(path)?;
    let identity = identity(&file)?;
    let bytes = file.metadata().map_err(io_error)?.len();
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    let mut read = 0u64;
    loop {
        let count = file.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        read = read
            .checked_add(count as u64)
            .ok_or("Publication byte count overflow")?;
        hash.update(&buffer[..count]);
    }
    if read != bytes {
        return Err("Publication file length changed".into());
    }
    let sha256 = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    Ok((
        file,
        Publication {
            bytes,
            sha256,
            identity,
        },
    ))
}

fn marker(job: &Job) -> Result<File> {
    let (file, actual) = evidence(&transfer::part(job, 4))
        .map_err(|_| conflict("owned assembly is missing, inaccessible or unsafe"))?;
    if job.publication.as_ref() != Some(&actual) {
        return Err(conflict("owned assembly changed"));
    }
    Ok(file)
}

fn destination(job: &Job) -> Result<Option<File>> {
    match job.destination.symlink_metadata() {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(conflict("destination is inaccessible")),
        Ok(_) => {}
    }
    let expected = job
        .publication
        .as_ref()
        .ok_or("Missing publication evidence")?;
    let file =
        open(&job.destination).map_err(|_| conflict("destination is inaccessible or unsafe"))?;
    if identity(&file).map_err(|_| conflict("cannot verify destination identity"))?
        != expected.identity
        || file.metadata().map_err(io_error)?.len() != expected.bytes
    {
        return Err(conflict("destination was replaced or truncated"));
    }
    Ok(Some(file))
}

fn completed(job: &mut Job) {
    let bytes = job
        .publication
        .as_ref()
        .expect("publication evidence")
        .bytes;
    job.status = Status::Completed;
    job.downloaded = bytes;
    job.total = Some(bytes);
    job.speed = 0;
    job.error = None;
    job.failure_reason = None;
    job.next_retry = None;
}

pub(super) fn recover(job: &mut Job) -> Result<Option<(File, File)>> {
    if job.publication.is_none() || [Status::Completed, Status::Cancelled].contains(&job.status) {
        return Ok(None);
    }
    let Some(destination) = destination(job)? else {
        return Ok(None);
    };
    let assembly = marker(job)?;
    job.recovery_mode = Some(RecoveryMode::PublicationRecovery);
    provenance::mark(job);
    completed(job);
    Ok(Some((assembly, destination)))
}

pub(super) fn owns_assembly(job: &Job) -> bool {
    if let Some(proof) = &job.publication
        && let Ok(file) = open(&transfer::part(job, 4))
        && identity(&file).is_ok_and(|id| id == proof.identity)
    {
        return true;
    }
    false
}

pub(super) fn cleanup(job: &Job) {
    if job.status == Status::Completed && owns_assembly(job) {
        transfer::cleanup(job);
    }
}

pub(super) fn publish(manager: &Manager, id: &str, token: &CancellationToken) -> Result<()> {
    let mut job = manager.job(id)?;
    let assembly = if job.publication.is_some() {
        let file = marker(&job)?;
        job.recovery_mode = Some(RecoveryMode::PublicationRecovery);
        file
    } else {
        let (file, proof) = evidence(&transfer::part(&job, 4))?;
        if proof.bytes != job.downloaded || job.total.is_some_and(|total| total != proof.bytes) {
            return Err("Final byte count does not match the resource".into());
        }
        job.publication = Some(proof);
        file
    };
    let mut state = manager.state.lock().expect("state lock");
    let index = state
        .jobs
        .iter()
        .position(|j| j.id == id)
        .ok_or("Download not found")?;
    if state.jobs[index].status != Status::Downloading || token.is_cancelled() {
        return Err("Paused".into());
    }
    provenance::mark(&mut job);
    if state.jobs[index].publication.is_none() {
        save(&state, &job)?;
        state.jobs[index] = job.clone();
    }
    let destination_guard = if let Some(file) = destination(&job)? {
        file
    } else {
        #[cfg(test)]
        crate::publication_tests::fault("before_link");
        // shortcut: no-clobber publication requires hard-link-capable destination storage.
        std::fs::hard_link(transfer::part(&job, 4), &job.destination).map_err(io_error)?;
        #[cfg(test)]
        crate::publication_tests::fault("after_link");
        destination(&job)?.ok_or_else(|| conflict("destination disappeared after publication"))?
    };
    completed(&mut job);
    save(&state, &job)?;
    state.jobs[index] = job.clone();
    #[cfg(test)]
    crate::publication_tests::fault("after_commit");
    drop(state);
    drop(destination_guard);
    drop(assembly);
    cleanup(&job);
    Ok(())
}
