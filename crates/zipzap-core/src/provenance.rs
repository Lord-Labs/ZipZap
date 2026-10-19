use super::*;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Provenance {
    Internet,
    Unavailable,
}

#[cfg(windows)]
fn stream(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(":Zone.Identifier");
    PathBuf::from(name)
}

/// Check current metadata before explicit open; saved history cannot prove it survived a move.
pub fn has_internet_zone(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::io::Read;
        if !path
            .symlink_metadata()
            .is_ok_and(|metadata| metadata.file_type().is_file())
        {
            return false;
        }
        let Ok(file) = std::fs::File::open(stream(path)) else {
            return false;
        };
        let mut bytes = Vec::new();
        if file.take(4097).read_to_end(&mut bytes).is_err() || bytes.len() > 4096 {
            return false;
        }
        let Ok(value) = std::str::from_utf8(&bytes) else {
            return false;
        };
        let mut in_zone = false;
        let mut zone = None;
        for line in value.lines() {
            let line = line.trim();
            if line.starts_with('[') {
                in_zone = line.eq_ignore_ascii_case("[ZoneTransfer]");
            }
            if in_zone && let Some(value) = line.strip_prefix("ZoneId=") {
                if zone.is_some() {
                    return false;
                }
                zone = Some(["3", "4"].contains(&value));
            }
        }
        zone.unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        false
    }
}

#[cfg(all(test, windows))]
#[test]
fn current_marker_check_rejects_absent_ambiguous_untrusted_and_oversized_streams() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("fixture.txt");
    std::fs::write(&path, b"payload").unwrap();
    assert!(!has_internet_zone(&path));
    for bytes in [
        "[ZoneTransfer]\r\nZoneId=0\r\n".to_owned(),
        "[Other]\r\nZoneId=3\r\n".into(),
        "[ZoneTransfer]\r\nZoneId=3\r\nZoneId=0\r\n".into(),
        format!("[ZoneTransfer]\r\nZoneId=3\r\n{}", "x".repeat(4096)),
    ] {
        std::fs::write(stream(&path), bytes).unwrap();
        assert!(!has_internet_zone(&path));
        assert_eq!(std::fs::read(&path).unwrap(), b"payload");
    }
}

pub(super) fn mark(job: &mut Job) {
    #[cfg(windows)]
    {
        use std::{io::Write, os::windows::fs::OpenOptionsExt};
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        let assembly = transfer::part(job, 4);
        let applied = if has_internet_zone(&assembly) {
            true
        } else {
            // The publication handle guards the owned base file against replacement.
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(stream(&assembly))
                .and_then(|mut file| {
                    file.write_all(b"[ZoneTransfer]\r\nZoneId=3\r\n")?;
                    file.sync_all()
                })
                .is_ok()
                && has_internet_zone(&assembly)
        };
        job.provenance = Some(if applied {
            Provenance::Internet
        } else {
            Provenance::Unavailable
        });
    }
    #[cfg(not(windows))]
    {
        let _ = job;
    }
}
