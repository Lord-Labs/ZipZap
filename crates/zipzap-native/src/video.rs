pub fn youtube_id(value: &str) -> Option<String> {
    let url = zipzap_core::validate_url(value).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some("www.youtube.com")
        || url.port().is_some()
        || url.path() != "/watch"
        || url.fragment().is_some()
    {
        return None;
    }
    let id = url.query()?.strip_prefix("v=")?;
    if id.len() != 11
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
    {
        return None;
    }
    Some(id.into())
}
pub fn direct(value: &str) -> bool {
    zipzap_core::validate_url(value).is_ok_and(|url| {
        url.fragment().is_none()
            && [".mp4", ".webm"]
                .iter()
                .any(|suffix| url.path().to_ascii_lowercase().ends_with(suffix))
    })
}
pub fn source(value: &str) -> Result<String, String> {
    let url = zipzap_core::validate_url(value).map_err(|_| "Invalid video source")?;
    if youtube_id(url.as_str()).is_none() && !direct(url.as_str()) {
        return Err("Unsupported video source".into());
    }
    Ok(url.to_string())
}
pub fn resolved(value: &str) -> bool {
    zipzap_core::validate_url(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.fragment().is_none()
            && url
                .host_str()
                .is_some_and(|host| host.ends_with(".googlevideo.com"))
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_canonical_watch_and_explicit_file_sources_are_accepted() {
        assert_eq!(
            youtube_id("https://www.youtube.com/watch?v=YE7VzlLtp-4").as_deref(),
            Some("YE7VzlLtp-4")
        );
        for value in [
            "https://www.youtube.com/watch?v=YE7VzlLtp-4&list=x",
            "http://www.youtube.com/watch?v=YE7VzlLtp-4",
            "https://www.youtube.com:444/watch?v=YE7VzlLtp-4",
            "https://www.youtube.com.evil.test/watch?v=YE7VzlLtp-4",
            "https://www.youtube.com/watch?v=short",
            "blob:https://www.youtube.com/abc",
        ] {
            assert!(source(value).is_err());
        }
        assert!(source("https://cdn.example.com/clip.MP4?signature=private").is_ok());
        assert!(source("https://cdn.example.com/clip.webm").is_ok());
        assert!(source("https://cdn.example.com/stream.m3u8").is_err());
        assert!(source("https://user:pass@example.com/clip.mp4").is_err());
        assert!(resolved(
            "https://r1.googlevideo.com/videoplayback?signature=private"
        ));
        for value in [
            "http://r1.googlevideo.com/file",
            "https://r1.googlevideo.com.evil.test/file",
            "https://googlevideo.com@evil.test/file",
        ] {
            assert!(!resolved(value));
        }
    }
}
