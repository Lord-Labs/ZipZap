#![cfg_attr(windows, windows_subsystem = "windows")]

// Null stdio alone still lets Windows inherit the browser's original pipe handles.
#[cfg(windows)]
fn detach_browser_pipes() -> std::io::Result<()> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetStdHandle(kind: u32) -> *mut std::ffi::c_void;
        fn SetHandleInformation(handle: *mut std::ffi::c_void, mask: u32, flags: u32) -> i32;
    }
    for kind in [-10i32, -11, -12] {
        // Only alter inheritance on this short-lived host's own standard handles.
        unsafe {
            let handle = GetStdHandle(kind as u32);
            if !handle.is_null() && handle as isize != -1 && SetHandleInformation(handle, 1, 0) == 0
            {
                return Err(std::io::Error::last_os_error());
            }
        }
    }
    Ok(())
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--unregister-native") {
        let result = (|| {
            let binary =
                std::path::PathBuf::from(std::env::args().nth(2).ok_or("Missing host path")?);
            if !binary.is_absolute()
                || binary.file_name().and_then(|name| name.to_str()) != Some("zipzap-native.exe")
            {
                return Err("Invalid host path".to_owned());
            }
            let root = std::path::PathBuf::from(
                std::env::var_os("LOCALAPPDATA").ok_or("Missing user state")?,
            )
            .join(zipzap_native::APP_ID);
            #[cfg(windows)]
            let result = zipzap_native::unregister(&binary, &root);
            #[cfg(not(windows))]
            let result = {
                let _ = root;
                Ok::<(), String>(())
            };
            result
        })();
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
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
                #[cfg(windows)]
                detach_browser_pipes().ok()?;
                let mut command =
                    std::process::Command::new(exe.with_file_name("zipzap-desktop.exe"));
                if value["version"] == 3 {
                    command.arg("--browser-background");
                }
                command
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
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
