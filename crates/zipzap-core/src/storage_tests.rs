use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::atomic::{AtomicBool, Ordering},
};

impl Manager {
    pub(super) fn file_failure(&self, phase: &str, bytes: u64) -> Result<()> {
        let mut fault = self.file_fault.lock().unwrap();
        if fault
            .as_ref()
            .is_some_and(|(point, minimum, _)| *point == phase && bytes >= *minimum)
        {
            let (_, _, kind) = fault.take().unwrap();
            return Err(io_error(std::io::Error::from(kind)));
        }
        Ok(())
    }
}

struct Server {
    url: String,
    bytes: Arc<Vec<u8>>,
    ranges: Arc<Mutex<Vec<(u64, u64)>>>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Server {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file.bin", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let bytes = Arc::new(
            (0..3 * 1024 * 1024)
                .map(|i| (i * 31) as u8)
                .collect::<Vec<_>>(),
        );
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (data, recorded, stopped) =
            (Arc::clone(&bytes), Arc::clone(&ranges), Arc::clone(&stop));
        let thread = std::thread::spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                let (mut stream, _) = match listener.accept() {
                    Ok(value) => value,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(error) => panic!("fixture accept: {error}"),
                };
                // On Windows, accepted sockets inherit the listener's nonblocking mode.
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") && request.len() < 16384 {
                    let mut byte = [0];
                    if stream.read(&mut byte).unwrap_or(0) == 0 {
                        break;
                    }
                    request.push(byte[0]);
                }
                let request = String::from_utf8(request).unwrap().to_ascii_lowercase();
                if request.is_empty() {
                    continue;
                }
                let (start, end) = request
                    .lines()
                    .find_map(|line| {
                        let value = line.strip_prefix("range: bytes=")?;
                        let (start, end) = value.split_once('-')?;
                        Some((start.parse::<u64>().ok()?, end.parse::<u64>().ok()?))
                    })
                    .unwrap_or_else(|| panic!("missing fixture range: {request:?}"));
                recorded.lock().unwrap().push((start, end));
                let header = format!(
                    "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {start}-{end}/{}\r\nContent-Length: {}\r\nETag: \"storage-v1\"\r\nConnection: close\r\n\r\n",
                    data.len(),
                    end - start + 1
                );
                let _ = stream
                    .write_all(header.as_bytes())
                    .and_then(|_| stream.write_all(&data[start as usize..=end as usize]));
            }
        });
        Self {
            url,
            bytes,
            ranges,
            stop,
            thread: Some(thread),
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let result = self.thread.take().unwrap().join();
        if !std::thread::panicking() {
            result.unwrap();
        }
    }
}

#[test]
fn fixture_waits_for_delayed_request_headers() {
    let server = Server::new();
    let address = Url::parse(&server.url)
        .unwrap()
        .socket_addrs(|| None)
        .unwrap()[0];
    let mut client = std::net::TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    client.write_all(b"GET /file.bin HTTP/1.1\r\n").unwrap();
    // Let the fixture accept/read before the rest of the headers arrive.
    std::thread::sleep(Duration::from_millis(50));
    client
        .write_all(b"Host: localhost\r\nRange: bytes=0-0\r\nConnection: close\r\n\r\n")
        .unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).unwrap();
    assert!(response.starts_with(b"HTTP/1.1 206 Partial Content\r\n"));
    let header_end = response
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .unwrap()
        + 4;
    assert_eq!(&response[header_end..], &server.bytes[..1]);
}

#[tokio::test]
async fn file_failures_stop_and_reuse_validated_checkpoints_after_repair() {
    use std::io::ErrorKind;
    for (phase, threshold, kind, reason) in [
        ("write", 1024 * 1024, ErrorKind::StorageFull, "full"),
        (
            "flush",
            2 * 1024 * 1024,
            ErrorKind::ReadOnlyFilesystem,
            "access",
        ),
        ("assembly", 0, ErrorKind::StorageFull, "full"),
    ] {
        let server = Server::new();
        let folder = tempfile::tempdir().unwrap();
        let database = folder.path().join("state.sqlite");
        let manager = Manager::open(&database).unwrap();
        let destination = folder.path().join("downloads");
        std::fs::create_dir(&destination).unwrap();
        manager
            .set_settings(Settings {
                connections: 1,
                ..Settings::default()
            })
            .unwrap();
        let job = manager.add(&server.url, &destination, None).unwrap();
        manager
            .update(&job.id, |j| j.status = Status::Downloading)
            .unwrap();
        *manager.file_fault.lock().unwrap() = Some((phase, threshold, kind));
        manager.worker(&job.id, CancellationToken::new()).await;
        let failed = manager.job(&job.id).unwrap();
        assert_eq!(failed.status, Status::Failed, "{phase}: {failed:?}");
        assert!(
            failed
                .error
                .as_ref()
                .unwrap()
                .starts_with(&format!("Storage error: {reason}.")),
            "{phase}: {failed:?}"
        );
        assert!(!job.destination.exists());
        let saved = failed.segments[0].done;
        assert!(saved >= 1024 * 1024);
        assert_eq!(
            &std::fs::read(transfer::part(&job, 0)).unwrap()[..saved as usize],
            &server.bytes[..saved as usize]
        );
        let recorded = server.ranges.lock().unwrap().clone();
        assert_eq!(
            recorded.len(),
            2,
            "{phase}: storage error retried automatically; ranges={recorded:?}; job={failed:?}"
        );
        drop(manager);
        if phase == "write" {
            let offline = folder.path().join("offline");
            assert_eq!(destination.parent(), Some(folder.path()));
            assert_eq!(offline.parent(), Some(folder.path()));
            std::fs::rename(&destination, &offline).unwrap();
            let manager = Manager::open(&database).unwrap();
            manager.action(&job.id, "resume").unwrap();
            manager
                .update(&job.id, |j| j.status = Status::Downloading)
                .unwrap();
            manager.worker(&job.id, CancellationToken::new()).await;
            let failed = manager.job(&job.id).unwrap();
            assert_eq!(
                failed.failure_reason,
                Some(FailureReason::DestinationMissing)
            );
            assert_eq!(failed.segments[0].done, saved);
            assert_eq!(server.ranges.lock().unwrap().len(), 2);
            drop(manager);
            std::fs::rename(&offline, &destination).unwrap();
        }
        let manager = Manager::open(&database).unwrap();
        assert_eq!(manager.job(&job.id).unwrap().segments[0].done, saved);
        manager.action(&job.id, "resume").unwrap();
        manager
            .update(&job.id, |j| j.status = Status::Downloading)
            .unwrap();
        manager.worker(&job.id, CancellationToken::new()).await;
        let repaired = manager.job(&job.id).unwrap();
        assert_eq!(
            repaired.status,
            Status::Completed,
            "{phase}: {repaired:?}; ranges={:?}",
            server.ranges.lock().unwrap()
        );
        assert_eq!(std::fs::read(&job.destination).unwrap(), *server.bytes);
        let ranges = server.ranges.lock().unwrap();
        if saved < server.bytes.len() as u64 {
            assert_eq!(
                ranges.last().unwrap().0,
                saved,
                "valid prefix was downloaded again"
            );
        } else {
            assert_eq!(ranges.len(), 3, "complete parts were downloaded again");
        }
    }
}
