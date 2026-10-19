#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    let origin = std::env::args().nth(1).unwrap_or_default();
    let Some(root) = std::env::var_os("LOCALAPPDATA") else {
        return;
    };
    let state = std::path::PathBuf::from(root).join(zipzap_native::APP_ID);
    let mut response = Vec::new();
    let Ok(launch) =
        zipzap_native::receive(&mut std::io::stdin().lock(), &mut response, &origin, &state)
    else {
        return;
    };
    if let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(&response[4..])
        && launch
    {
        let launched = std::env::current_exe()
            .ok()
            .and_then(|exe| {
                std::process::Command::new(exe.with_file_name("zipzap-desktop.exe"))
                    .spawn()
                    .ok()
            })
            .is_some();
        if !launched && value["version"] == 2 {
            if let Some(id) = value["id"].as_str() {
                let _ = zipzap_native::save_result(
                    &state,
                    id,
                    zipzap_native::Outcome::Rejected {
                        code: zipzap_native::Rejection::AppStartFailed,
                    },
                );
            }
            value["state"] = "rejected".into();
            value["code"] = "app_start_failed".into();
            if let Ok(bytes) = serde_json::to_vec(&value) {
                response = (bytes.len() as u32).to_ne_bytes().to_vec();
                response.extend(bytes);
            }
        }
    }
    use std::io::Write;
    let mut output = std::io::stdout().lock();
    let _ = output.write_all(&response).and_then(|_| output.flush());
}
