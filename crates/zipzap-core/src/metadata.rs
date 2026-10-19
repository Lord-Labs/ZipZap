use super::*;
use reqwest::{StatusCode, header};

#[derive(Clone, Serialize, Debug)]
pub struct Suggestion {
    pub filename: String,
    pub total: Option<u64>,
    pub alternative: Option<String>,
    pub destination: PathBuf,
    pub category: String,
}

impl Manager {
    /// Advisory only: no file, job, reservation or response body is created/read.
    pub async fn suggest(
        &self,
        value: &str,
        folder: &Path,
        filename: Option<&str>,
        token: &CancellationToken,
    ) -> Result<Suggestion> {
        self.suggest_in(value, folder, filename, token, false).await
    }

    pub async fn suggest_auto(
        &self,
        value: &str,
        fallback: &Path,
        filename: Option<&str>,
        token: &CancellationToken,
    ) -> Result<Suggestion> {
        self.suggest_in(value, fallback, filename, token, true)
            .await
    }

    async fn suggest_in(
        &self,
        value: &str,
        folder: &Path,
        filename: Option<&str>,
        token: &CancellationToken,
        automatic: bool,
    ) -> Result<Suggestion> {
        let url = validate_url(value)?;
        let (name, total) = if let Some(name) = filename {
            validate_filename(name)?;
            (name.to_owned(), None)
        } else {
            let request = self
                .client
                .get(url)
                .header(header::ACCEPT_ENCODING, "identity")
                .header(header::RANGE, "bytes=0-0");
            let (response, _permit) = tokio::select! {
                biased;
                _ = token.cancelled() => return Err("Metadata probe cancelled".into()),
                _ = self.stop.cancelled() => return Err("Metadata probe cancelled".into()),
                result = tokio::time::timeout(Duration::from_secs(10), self.send(request, token)) => {
                    result.map_err(|_| "Metadata probe timed out")?.map_err(|error| error.message)?
                }
            };
            let empty = response.status() == StatusCode::RANGE_NOT_SATISFIABLE
                && response
                    .headers()
                    .get(header::CONTENT_RANGE)
                    .is_some_and(|v| v == "bytes */0");
            if !response.status().is_success() && !empty {
                return Err(retry::Failure::response(&response).message);
            }
            let mut headers = response
                .headers()
                .get_all(header::CONTENT_DISPOSITION)
                .iter();
            let first = headers.next();
            let name = if headers.next().is_none() {
                first.and_then(|value| disposition(value.as_bytes()))
            } else {
                None
            }
            .unwrap_or_else(|| url_name(response.url()));
            let total = if response.status() == StatusCode::PARTIAL_CONTENT {
                response
                    .headers()
                    .get(header::CONTENT_RANGE)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.strip_prefix("bytes 0-0/"))
                    .and_then(|v| v.parse::<u64>().ok())
            } else if response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
                response
                    .headers()
                    .get(header::CONTENT_RANGE)
                    .filter(|v| *v == "bytes */0")
                    .map(|_| 0)
            } else {
                response.content_length()
            };
            (name, total)
        };
        let state = self.state.lock().expect("state lock");
        let category = state
            .settings
            .category(&name)
            .ok_or("Invalid category settings")?;
        let destination = if automatic {
            category
                .download_folder
                .as_deref()
                .map(Path::new)
                .unwrap_or(folder)
        } else {
            folder
        };
        let folder = destination.canonicalize().map_err(
            |_| "Category or destination folder is unavailable; choose an existing folder",
        )?;
        if !folder.is_dir() {
            return Err("Destination must be an existing folder".into());
        }
        let occupied = |name: &str| {
            let path = folder.join(name);
            path.symlink_metadata().is_ok() || destination_queued(&state, &path)
        };
        let alternative = if occupied(&name) {
            let (stem, extension) = name
                .rsplit_once('.')
                .filter(|(stem, _)| !stem.is_empty())
                .map(|(stem, ext)| (stem, format!(".{ext}")))
                .unwrap_or((&name, String::new()));
            let mut free = None;
            for index in 1..=1000 {
                let suffix = format!(" ({index}){extension}");
                if suffix.len() >= 180 {
                    break;
                }
                let mut end = stem.len().min(180 - suffix.len());
                while !stem.is_char_boundary(end) {
                    end -= 1;
                }
                let candidate = format!("{}{suffix}", &stem[..end]);
                if validate_filename(&candidate).is_ok() && !occupied(&candidate) {
                    free = Some(candidate);
                    break;
                }
            }
            Some(free.ok_or("No free filename suggestion; choose another name")?)
        } else {
            None
        };
        Ok(Suggestion {
            filename: name,
            total,
            alternative,
            destination: folder,
            category: category.id.clone(),
        })
    }
}

pub(super) fn url_name(url: &Url) -> String {
    url.path_segments()
        .and_then(|mut parts| parts.next_back())
        .and_then(decode)
        .filter(|name| validate_filename(name).is_ok())
        .unwrap_or_else(|| "download.bin".into())
}

fn decode(value: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(value.len());
    let mut input = value.as_bytes().iter().copied();
    while let Some(byte) = input.next() {
        bytes.push(if byte == b'%' {
            let hi = (input.next()? as char).to_digit(16)?;
            let lo = (input.next()? as char).to_digit(16)?;
            (hi * 16 + lo) as u8
        } else {
            byte
        });
    }
    String::from_utf8(bytes).ok()
}

fn disposition(bytes: &[u8]) -> Option<String> {
    if bytes.len() > 4096 {
        return None;
    }
    let value: String = bytes.iter().map(|b| char::from(*b)).collect();
    let mut quoted = false;
    let mut start = 0;
    let mut parts = Vec::new();
    for (index, c) in value.char_indices() {
        if c == '\\' {
            return None;
        }
        if c == '"' {
            quoted = !quoted;
        }
        if c == ';' && !quoted {
            parts.push(&value[start..index]);
            start = index + 1;
        }
    }
    if quoted {
        return None;
    }
    parts.push(&value[start..]);
    if !http_token(parts.first()?.trim()) {
        return None;
    }
    let mut plain = None;
    let mut extended = None;
    let mut saw_plain = false;
    let mut saw_extended = false;
    for part in parts.into_iter().skip(1) {
        let (key, value) = part.trim().split_once('=')?;
        let value = value.trim();
        if key.trim().eq_ignore_ascii_case("filename*") {
            if saw_extended {
                return None;
            }
            saw_extended = true;
            extended = value
                .split_once('\'')
                .and_then(|(charset, rest)| charset.eq_ignore_ascii_case("utf-8").then_some(rest))
                .and_then(|rest| rest.split_once('\''))
                .filter(|(_, encoded)| {
                    encoded
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"!#$&+-.^_`|~%".contains(&b))
                })
                .and_then(|(_, encoded)| decode(encoded))
                .filter(|name| validate_filename(name).is_ok());
        } else if key.trim().eq_ignore_ascii_case("filename") {
            if saw_plain {
                return None;
            }
            saw_plain = true;
            let name = if value.starts_with('"') {
                value.strip_prefix('"')?.strip_suffix('"')?
            } else {
                if !http_token(value) {
                    continue;
                }
                value
            };
            plain = (validate_filename(name).is_ok()).then(|| name.to_owned());
        }
    }
    extended.or(plain)
}

fn http_token(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[tokio::test]
    async fn probe_drops_ignored_range_body_and_cancels_before_headers_without_creating_jobs() {
        for mode in 0..4 {
            let headers = mode == 0;
            let folder = tempfile::tempdir().unwrap();
            let manager = Manager::open(&folder.path().join("state.sqlite")).unwrap();
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/report.zip", listener.local_addr().unwrap());
            let (ready, received) = tokio::sync::oneshot::channel();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(13)))
                    .unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") {
                    assert_eq!(socket.read(&mut byte).unwrap(), 1);
                    request.push(byte[0]);
                }
                assert!(String::from_utf8_lossy(&request).contains("range: bytes=0-0"));
                if headers {
                    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10000000000\r\nContent-Disposition: attachment; filename=report.zip\r\n\r\n").unwrap();
                }
                ready.send(()).unwrap();
                assert_eq!(
                    socket.read(&mut byte).unwrap(),
                    0,
                    "probe retained the body connection"
                );
            });
            let token = CancellationToken::new();
            let child_token = token.clone();
            let owner = Arc::clone(&manager);
            let destination = folder.path().to_owned();
            let probe =
                tokio::spawn(
                    async move { owner.suggest(&url, &destination, None, &child_token).await },
                );
            received.await.unwrap();
            if mode == 1 {
                token.cancel();
            }
            if mode == 3 {
                manager.shutdown().await;
                assert!(manager.is_stopping());
            }
            let result =
                tokio::time::timeout(Duration::from_secs(if mode == 2 { 12 } else { 2 }), probe)
                    .await
                    .unwrap()
                    .unwrap();
            if headers {
                assert_eq!(result.unwrap().total, Some(10_000_000_000));
            } else if mode == 1 || mode == 3 {
                assert!(result.unwrap_err().contains("cancelled"));
            } else {
                assert!(result.unwrap_err().contains("timed out"));
            }
            assert!(manager.jobs().is_empty());
            assert!(!folder.path().join("report.zip").exists());
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn suggestions_preserve_explicit_names_and_recheck_file_and_queue_races() {
        let folder = tempfile::tempdir().unwrap();
        let manager = Manager::open(&folder.path().join("state.sqlite")).unwrap();
        std::fs::write(folder.path().join("report.zip"), b"keep").unwrap();
        let queued = manager
            .add(
                "https://example.com/ignored",
                folder.path(),
                Some("report (1).zip"),
            )
            .unwrap();
        let proposal = manager
            .suggest(
                "https://example.com/server-name",
                folder.path(),
                Some("report.zip"),
                &CancellationToken::new(),
            )
            .await
            .unwrap();
        assert_eq!(proposal.filename, "report.zip");
        assert_eq!(proposal.alternative.as_deref(), Some("report (2).zip"));
        std::fs::write(folder.path().join("report (2).zip"), b"race").unwrap();
        assert!(
            manager
                .add(
                    "https://example.com/file",
                    folder.path(),
                    proposal.alternative.as_deref()
                )
                .is_err()
        );
        assert_eq!(
            std::fs::read(folder.path().join("report.zip")).unwrap(),
            b"keep"
        );
        manager.action(&queued.id, "cancel").unwrap();
        let next = manager
            .suggest(
                "https://example.com/file",
                folder.path(),
                Some("report.zip"),
                &CancellationToken::new(),
            )
            .await
            .unwrap();
        assert_eq!(next.alternative.as_deref(), Some("report (1).zip"));
    }
    #[test]
    fn server_and_url_names_are_advisory_and_never_salvage_paths() {
        for (header, expected) in [
            ("attachment; filename=report.zip", Some("report.zip")),
            (
                "attachment; filename=old.zip; filename*=UTF-8''%D9%85%D9%84%D9%81.zip",
                Some("ملف.zip"),
            ),
            (
                "attachment; filename=old.zip; filename*=UTF-8''bad%ff",
                Some("old.zip"),
            ),
            (
                "attachment; filename=old.zip; filename*=unsupported''new.zip",
                Some("old.zip"),
            ),
            (
                "attachment; filename=\"report; Q1.zip\"",
                Some("report; Q1.zip"),
            ),
            ("attachment; filename=CON.zip", None),
            ("; filename=report.zip", None),
            ("attachment; filename*=UTF-8''bad name.zip", None),
            ("attachment; filename=\"../evil.zip\"", None),
            ("attachment; filename*=UTF-8''..%2Fevil.zip", None),
            ("attachment; filename=\"..\\evil.zip\"", None),
            ("attachment; filename=a.zip; FILENAME=b.zip", None),
            ("attachment; filename=\"unterminated", None),
            ("attachment; filename*=UTF-8''%E2%80%AEevil.zip", None),
        ] {
            assert_eq!(
                disposition(header.as_bytes()).as_deref(),
                expected,
                "{header}"
            );
        }
        assert_eq!(
            disposition(b"attachment; filename=\"caf\xe9.zip\"").as_deref(),
            Some("café.zip")
        );
        assert_eq!(
            disposition(format!("attachment; filename={}", "a".repeat(181)).as_bytes()),
            None
        );
        assert_eq!(
            url_name(&Url::parse("https://example.com/%D9%85%D9%84%D9%81.zip").unwrap()),
            "ملف.zip"
        );
        assert_eq!(
            url_name(&Url::parse("https://example.com/..%2Fevil").unwrap()),
            "download.bin"
        );
    }
}
