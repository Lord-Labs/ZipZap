//! Bounded loopback-only feasibility probe, not ZipZap's production engine.
use reqwest::{Client, StatusCode, Url, header};
use std::{error::Error, fs::OpenOptions, io::Write, path::Path, time::Duration};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const SIZE: usize = 8 * 1024 * 1024;
const ETAG: &str = "\"fixture-v1\"";

fn fixture_url(value: &str) -> Result<Url> {
    let url = Url::parse(value)?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("probe accepts only explicit-port HTTP IPv4 loopback URLs".into());
    }
    Ok(url)
}

async fn range(client: &Client, url: &Url, start: usize, end: usize) -> Result<Vec<u8>> {
    let mut response = client
        .get(url.clone())
        .header(header::ACCEPT_ENCODING, "identity")
        .header(header::RANGE, format!("bytes={start}-{end}"))
        .header(header::IF_RANGE, ETAG)
        .send()
        .await?;
    let expected = format!("bytes {start}-{end}/{SIZE}");
    if response.status() != StatusCode::PARTIAL_CONTENT
        || response
            .headers()
            .get(header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            != Some(expected.as_str())
        || response
            .headers()
            .get(header::ETAG)
            .and_then(|v| v.to_str().ok())
            != Some(ETAG)
        || response.headers().contains_key(header::CONTENT_ENCODING)
    {
        return Err("range status, bounds, identity, or encoding changed".into());
    }
    // shortcut: buffer at most one 4 MiB fixture range, stream to disk in production issue #3.
    let length = end - start + 1;
    let mut bytes = Vec::with_capacity(length);
    while let Some(chunk) = response.chunk().await? {
        if chunk.len() > length - bytes.len() {
            return Err("range body exceeds requested bounds".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() != length {
        return Err("truncated range body".into());
    }
    Ok(bytes)
}

async fn run(mode: &str, url: &Url, output: &Path) -> Result<()> {
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()?;
    match mode {
        "split" => {
            let (first, second) = tokio::try_join!(
                range(&client, url, 0, SIZE / 2 - 1),
                range(&client, url, SIZE / 2, SIZE - 1)
            )?;
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output)?;
            file.write_all(&first)?;
            file.write_all(&second)?;
            file.sync_all()?;
        }
        "resume" => {
            let mut file = OpenOptions::new().append(true).open(output)?;
            if file.metadata()?.len() != (SIZE / 2) as u64 {
                return Err("resume requires the harness's half-complete fixture file".into());
            }
            let tail = range(&client, url, SIZE / 2, SIZE - 1).await?;
            file.write_all(&tail)?;
            file.sync_all()?;
        }
        "cancel" => {
            let mut response = client.get(url.clone()).send().await?.error_for_status()?;
            let chunk = response
                .chunk()
                .await?
                .ok_or("empty cancellation fixture")?;
            if chunk.is_empty() || chunk.len() >= SIZE {
                return Err("cancellation fixture did not yield a partial body".into());
            }
            drop(response);
            println!("cancelled after receiving a partial body");
        }
        _ => return Err("expected split, resume, or cancel".into()),
    }
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 4 {
        return Err(
            "usage: zipzap-engine-probe <split|resume|cancel> <fixture-url> <output>".into(),
        );
    }
    let url = fixture_url(&args[2])?;
    run(&args[1], &url, Path::new(&args[3])).await
}

#[cfg(test)]
mod tests {
    use super::fixture_url;

    #[test]
    fn accepts_only_the_explicit_loopback_fixture() {
        assert!(fixture_url("http://127.0.0.1:12345/range").is_ok());
        for url in [
            "https://127.0.0.1:12345/range",
            "http://example.com:12345/range",
            "http://127.0.0.1/range",
            "http://user:password@127.0.0.1:12345/range",
            "file:///tmp/file",
        ] {
            assert!(fixture_url(url).is_err(), "accepted non-fixture URL");
        }
    }
}
