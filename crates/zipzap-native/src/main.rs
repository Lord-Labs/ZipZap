#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
fn launch_app(executable: &std::path::Path, background: bool) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{CreateProcessW, DETACHED_PROCESS, PROCESS_INFORMATION, STARTUPINFOW},
    };
    let application: Vec<u16> = executable
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut arguments = std::ffi::OsString::from("\"");
    arguments.push(executable);
    arguments.push("\"");
    if background {
        arguments.push(" --browser-background");
    }
    let mut arguments: Vec<u16> = arguments.encode_wide().chain(Some(0)).collect();
    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    // The GUI needs no inherited handles, including browser pipes outside standard IO.
    if unsafe {
        CreateProcessW(
            application.as_ptr(),
            arguments.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            DETACHED_PROCESS,
            std::ptr::null(),
            std::ptr::null(),
            &startup,
            &mut process,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error());
    }
    unsafe {
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
    }
    Ok(())
}

#[cfg(not(windows))]
fn launch_app(executable: &std::path::Path, background: bool) -> std::io::Result<()> {
    let mut command = std::process::Command::new(executable);
    if background {
        command.arg("--browser-background");
    }
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
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
                launch_app(
                    &exe.with_file_name("zipzap-desktop.exe"),
                    value["version"] == 3,
                )
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
