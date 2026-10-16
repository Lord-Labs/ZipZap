use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::Path,
};

pub const APP_ID: &str = "com.zipzap.desktop";
pub const HOST: &str = "com.zipzap.native";
pub fn extension_id() -> String {
    serde_json::from_str::<serde_json::Value>(include_str!(
        "../../../extensions/browser/identity.json"
    ))
    .expect("bundled identity")["id"]
        .as_str()
        .expect("identity ID")
        .to_owned()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    pub url: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Inbox {
    pub version: u32,
    pub id: String,
    pub url: String,
}

pub fn receive(
    reader: &mut impl Read,
    writer: &mut impl Write,
    origin: &str,
    state: &Path,
) -> Result<(), String> {
    let response = process(reader, origin, state);
    let value = match response {
        Ok(id) => serde_json::json!({"ok":true,"id":id}),
        Err(error) => serde_json::json!({"ok":false,"error":error}),
    };
    let bytes = serde_json::to_vec(&value).map_err(|_| "Cannot encode response")?;
    writer
        .write_all(&(bytes.len() as u32).to_ne_bytes())
        .and_then(|_| writer.write_all(&bytes))
        .and_then(|_| writer.flush())
        .map_err(|_| "Cannot write native response".to_owned())
}

fn process(reader: &mut impl Read, origin: &str, state: &Path) -> Result<String, String> {
    if origin != format!("chrome-extension://{}/", extension_id()) {
        return Err("Unexpected extension identity".into());
    }
    let mut prefix = [0u8; 4];
    reader
        .read_exact(&mut prefix)
        .map_err(|_| "Missing message length")?;
    let length = u32::from_ne_bytes(prefix) as usize;
    if length == 0 || length > 32768 {
        return Err("Native message size rejected".into());
    }
    let mut data = vec![0; length];
    reader
        .read_exact(&mut data)
        .map_err(|_| "Truncated native message")?;
    let request: Request = serde_json::from_slice(&data).map_err(|_| "Invalid native message")?;
    if request.version != 1 {
        return Err("Unsupported message version".into());
    }
    zipzap_core::validate_url(&request.url)?;
    let folder = state.join("inbox");
    std::fs::create_dir_all(&folder).map_err(|_| "Cannot create local inbox")?;
    if std::fs::read_dir(&folder)
        .map_err(|_| "Cannot inspect local inbox")?
        .take(101)
        .count()
        >= 100
    {
        return Err("ZipZap inbox is full; open the application".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let path = folder.join(format!("{id}.tmp"));
    let pending = Inbox {
        version: 1,
        id: id.clone(),
        url: request.url,
    };
    let bytes = serde_json::to_vec(&pending).map_err(|_| "Cannot encode local request")?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| "Cannot create local request")?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Cannot save local request")?;
    drop(file);
    std::fs::rename(&path, folder.join(format!("{id}.json")))
        .map_err(|_| "Cannot publish local request")?;
    Ok(id)
}

#[cfg(windows)]
pub fn register(binary: &Path, state: &Path) -> Result<(), String> {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};
    if !binary.is_file() {
        return Err("Native host binary is missing".into());
    }
    std::fs::create_dir_all(state).map_err(|e| e.to_string())?;
    let manifest = state.join("native-host.json");
    let value = serde_json::json!({"name":HOST,"description":"ZipZap browser handoff","path":binary,"type":"stdio","allowed_origins":[format!("chrome-extension://{}/",extension_id())]});
    std::fs::write(
        &manifest,
        serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let current = RegKey::predef(HKEY_CURRENT_USER);
    for vendor in ["Google\\Chrome", "Microsoft\\Edge"] {
        let (key, _) = current
            .create_subkey(format!("Software\\{vendor}\\NativeMessagingHosts\\{HOST}"))
            .map_err(|e| e.to_string())?;
        key.set_value("", &manifest.to_string_lossy().to_string())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn send(payload: &[u8], origin: &str, state: &Path) -> serde_json::Value {
        let mut input = (payload.len() as u32).to_ne_bytes().to_vec();
        input.extend_from_slice(payload);
        let mut output = Vec::new();
        receive(&mut &input[..], &mut output, origin, state).unwrap();
        assert_eq!(
            u32::from_ne_bytes(output[..4].try_into().unwrap()) as usize,
            output.len() - 4
        );
        serde_json::from_slice(&output[4..]).unwrap()
    }
    #[test]
    fn validates_origin_schema_and_url_before_writing() {
        let temp = tempfile::tempdir().unwrap();
        let origin = format!("chrome-extension://{}/", extension_id());
        for payload in [
            br#"{"version":1,"url":"file:///private"}"#.as_slice(),
            br#"{"version":2,"url":"https://example.com"}"#,
            br#"{"version":1,"url":"https://example.com","folder":"/tmp"}"#,
            b"bad json",
        ] {
            assert_eq!(send(payload, &origin, temp.path())["ok"], false);
        }
        assert_eq!(
            send(
                br#"{"version":1,"url":"https://example.com"}"#,
                "chrome-extension://wrong/",
                temp.path()
            )["ok"],
            false
        );
        assert!(!temp.path().join("inbox").exists());
        let answer = send(
            br#"{"version":1,"url":"https://example.com/file.zip"}"#,
            &origin,
            temp.path(),
        );
        assert_eq!(answer["ok"], true);
        assert!(
            temp.path()
                .join("inbox")
                .join(format!("{}.json", answer["id"].as_str().unwrap()))
                .is_file()
        );
    }
    #[test]
    fn rejects_oversized_and_truncated_frames() {
        let temp = tempfile::tempdir().unwrap();
        let origin = format!("chrome-extension://{}/", extension_id());
        let mut out = Vec::new();
        receive(
            &mut &u32::MAX.to_ne_bytes()[..],
            &mut out,
            &origin,
            temp.path(),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&out[4..]).unwrap()["ok"],
            false
        );
        let mut input = 20u32.to_ne_bytes().to_vec();
        input.extend_from_slice(b"{}");
        let mut out = Vec::new();
        receive(&mut &input[..], &mut out, &origin, temp.path()).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&out[4..]).unwrap()["ok"],
            false
        );
    }
}
