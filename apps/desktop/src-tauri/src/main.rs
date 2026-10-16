#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
mod app;
#[cfg(windows)]
fn main() {
    if std::env::args().nth(1).as_deref() == Some("--register-native") {
        let result = (|| -> Result<(), String> {
            let state = std::path::PathBuf::from(
                std::env::var_os("LOCALAPPDATA").ok_or("Missing user profile")?,
            )
            .join(zipzap_native::APP_ID);
            let binary = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .with_file_name("zipzap-native.exe");
            zipzap_native::register(&binary, &state)
        })();
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    app::run();
}
#[cfg(not(windows))]
fn main() {
    eprintln!("The ZipZap desktop beta currently supports Windows only.");
}
