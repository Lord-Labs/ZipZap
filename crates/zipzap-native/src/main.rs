#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    let origin = std::env::args().nth(1).unwrap_or_default();
    let Some(root) = std::env::var_os("LOCALAPPDATA") else {
        return;
    };
    let state = std::path::PathBuf::from(root).join(zipzap_native::APP_ID);
    let mut response = Vec::new();
    if zipzap_native::receive(&mut std::io::stdin().lock(), &mut response, &origin, &state).is_err()
    {
        return;
    }
    use std::io::Write;
    let mut output = std::io::stdout().lock();
    if output
        .write_all(&response)
        .and_then(|_| output.flush())
        .is_err()
    {
        return;
    }
    let accepted = serde_json::from_slice::<serde_json::Value>(&response[4..])
        .ok()
        .is_some_and(|v| v["ok"] == true);
    if !accepted {
        return;
    }
    if origin == format!("chrome-extension://{}/", zipzap_native::extension_id())
        && let Ok(exe) = std::env::current_exe()
    {
        let app = exe.with_file_name("zipzap-desktop.exe");
        if app.is_file() {
            let _ = std::process::Command::new(app).spawn();
        }
    }
}
