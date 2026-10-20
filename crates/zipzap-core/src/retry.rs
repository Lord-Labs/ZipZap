use super::*;
use std::{error::Error, time::SystemTime};

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum FailureReason {
    Network,
    Server,
    RateLimited,
    Http,
    Authentication,
    Tls,
    StorageFull,
    StorageAccess,
    DestinationMissing,
    Storage,
    Input,
    Integrity,
    Conflict,
}

#[derive(Debug)]
pub(super) struct Failure {
    pub reason: FailureReason,
    pub message: String,
    pub retry_after: Option<Duration>,
}
pub(super) type TransferResult<T> = std::result::Result<T, Failure>;

impl Failure {
    pub fn delay(&self, attempt: usize) -> Option<Duration> {
        matches!(
            self.reason,
            FailureReason::Network | FailureReason::Server | FailureReason::RateLimited
        )
        .then(|| {
            self.retry_after
                .unwrap_or_else(|| Duration::from_millis(500 * (1 << attempt.min(2))))
        })
    }
    pub fn network(error: reqwest::Error) -> Self {
        let mut cause: Option<&(dyn Error + 'static)> = Some(&error);
        let mut tls = false;
        while let Some(error) = cause {
            tls |= error.is::<native_tls::Error>();
            cause = error.source();
        }
        Self {
            reason: if tls {
                FailureReason::Tls
            } else if error.is_builder() {
                FailureReason::Input
            } else {
                FailureReason::Network
            },
            message: format!("Network request failed: {}", error.without_url()),
            retry_after: None,
        }
    }
    pub fn response(response: &reqwest::Response) -> Self {
        let status = response.status().as_u16();
        let reason = match status {
            401 | 403 => FailureReason::Authentication,
            429 => FailureReason::RateLimited,
            408 | 500 | 502 | 503 | 504 => FailureReason::Server,
            _ => FailureReason::Http,
        };
        let retry_after = matches!(status, 429 | 503)
            .then(|| {
                response
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| retry_after(value, SystemTime::now()))
            })
            .flatten();
        Self {
            reason,
            message: format!("Server returned HTTP {status}"),
            retry_after,
        }
    }
}
impl From<String> for Failure {
    fn from(message: String) -> Self {
        let reason = if message.starts_with("Storage error: full.") {
            FailureReason::StorageFull
        } else if message.starts_with("Storage error: access.") {
            FailureReason::StorageAccess
        } else if message.starts_with("Storage error: missing.") {
            FailureReason::DestinationMissing
        } else if message.starts_with("Storage error:")
            || message.starts_with("State database error:")
        {
            FailureReason::Storage
        } else if message.starts_with("Published file conflict:")
            || message.starts_with("Destination already exists")
        {
            FailureReason::Conflict
        } else if message.starts_with("Range rejected")
            || message.starts_with("Unsupported content encoding")
            || message.contains("byte count")
            || message.contains("checksum")
        {
            FailureReason::Integrity
        } else {
            FailureReason::Input
        };
        Self {
            reason,
            message,
            retry_after: None,
        }
    }
}
impl From<&str> for Failure {
    fn from(message: &str) -> Self {
        Self::from(message.to_owned())
    }
}

fn retry_after(value: &str, now: SystemTime) -> Option<Duration> {
    let value = value.trim();
    let delay = if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) {
        Duration::from_secs(value.parse::<u64>().unwrap_or(u64::MAX))
    } else {
        httpdate::parse_http_date(value)
            .ok()?
            .duration_since(now)
            .unwrap_or_default()
    };
    Some(delay.min(Duration::from_secs(30)))
}

pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_seconds_dates_and_rejects_malformed_retry_after_with_a_cap() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(784111777);
        assert_eq!(retry_after("5", now), Some(Duration::from_secs(5)));
        assert_eq!(
            retry_after("Sun, 06 Nov 1994 08:49:47 GMT", now),
            Some(Duration::from_secs(10))
        );
        assert_eq!(
            retry_after("Sun, 06 Nov 1994 08:49:27 GMT", now),
            Some(Duration::ZERO)
        );
        assert_eq!(
            retry_after("999999999999999999999999999999", now),
            Some(Duration::from_secs(30))
        );
        assert_eq!(retry_after("-1", now), None);
        assert_eq!(retry_after("tomorrow", now), None);
        assert_eq!(retry_after("", now), None);
    }
}
