#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
mod app;
#[cfg(windows)]
mod browser_setup;
#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod installer;
#[cfg(windows)]
mod lifecycle;
#[cfg(windows)]
mod media;
#[cfg(windows)]
mod support;
#[cfg(windows)]
fn main() {
    let mut args = std::env::args().skip(1);
    let action = args.next();
    if action.as_deref() == Some("--register-native") {
        let result = installer::register();
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    if action.as_deref() == Some("--prepare-install") {
        let language = args.next();
        let result = match (language.as_deref(), args.next()) {
            (Some(language @ ("en" | "ar")), None) => installer::prepare(language),
            _ => Err("Invalid setup arguments".into()),
        };
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    app::run();
}
#[cfg(not(windows))]
fn main() {
    eprintln!("The ZipZap desktop beta currently supports Windows only.");
}
