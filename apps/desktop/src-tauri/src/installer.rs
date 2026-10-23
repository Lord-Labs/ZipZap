use std::path::{Path, PathBuf};

fn state_directory() -> Result<PathBuf, String> {
    Ok(
        PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("Missing user profile")?)
            .join(zipzap_native::APP_ID),
    )
}

pub fn register() -> Result<(), String> {
    let binary = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name("zipzap-native.exe");
    zipzap_native::register(&binary, &state_directory()?)
}

fn downloads_directory() -> Result<PathBuf, String> {
    use std::{ffi::OsString, os::windows::ffi::OsStringExt};
    use windows_sys::Win32::{
        System::Com::CoTaskMemFree,
        UI::Shell::{FOLDERID_Downloads, SHGetKnownFolderPath},
    };
    let mut value = std::ptr::null_mut();
    // The shell resolves redirected/localized Downloads without creating a WebView.
    unsafe {
        let result = SHGetKnownFolderPath(&FOLDERID_Downloads, 0, std::ptr::null_mut(), &mut value);
        if result < 0 {
            CoTaskMemFree(value.cast());
            return Err("Windows Downloads folder is unavailable".into());
        }
        let mut length = 0;
        while *value.add(length) != 0 {
            length += 1;
        }
        let path = OsString::from_wide(std::slice::from_raw_parts(value, length));
        CoTaskMemFree(value.cast());
        Ok(path.into())
    }
}

fn prepare_state(root: &Path, downloads: &Path, language: &str) -> Result<(), String> {
    if !["en", "ar"].contains(&language) {
        return Err("Unsupported setup language".into());
    }
    let database = root.join("zipzap.sqlite");
    // Repair/upgrade must not even open an existing database or validate its saved folder.
    if database.try_exists().map_err(|e| e.to_string())? {
        return Ok(());
    }
    std::fs::create_dir_all(downloads).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let temporary = tempfile::Builder::new()
        .prefix("zipzap-setup-")
        .suffix(".sqlite")
        .tempfile_in(root)
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let manager = zipzap_core::Manager::open(temporary.path())?;
        let mut settings = manager.settings();
        settings.language = language.into();
        settings.download_folder = Some(downloads.to_string_lossy().into_owned());
        manager.set_settings(settings)
    })();
    let _ = std::fs::remove_file(temporary.path().with_extension("sqlite.lock"));
    result?;
    // Publish only complete defaults, never replacing a database created concurrently.
    temporary
        .persist_noclobber(database)
        .map_err(|e| e.error.to_string())?;
    Ok(())
}

pub fn prepare(language: &str) -> Result<(), String> {
    prepare_state(&state_directory()?, &downloads_directory()?, language)?;
    register()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_install_prepares_defaults_without_starting_downloads() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("state");
        let downloads = temp.path().join("ملفات Downloads");
        prepare_state(&root, &downloads, "ar").unwrap();
        let manager = zipzap_core::Manager::open(&root.join("zipzap.sqlite")).unwrap();
        let settings = manager.settings();
        assert_eq!(settings.language, "ar");
        assert_eq!(settings.download_folder.as_deref(), downloads.to_str());
        assert!(!settings.close_to_tray && !settings.notifications);
        assert!(manager.jobs().is_empty());
        assert!(std::fs::read_dir(&downloads).unwrap().next().is_none());
        assert_eq!(
            std::fs::read_dir(&root)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("zipzap-setup-"))
                .count(),
            0
        );
    }

    #[test]
    fn repair_preserves_even_unreadable_future_state_and_unavailable_folder() {
        let temp = tempfile::tempdir().unwrap();
        let database = temp.path().join("zipzap.sqlite");
        let bytes = b"future schema or recovery data: do not open/migrate";
        std::fs::write(&database, bytes).unwrap();
        let unavailable = temp.path().join("offline-folder");
        std::fs::write(&unavailable, b"not a directory").unwrap();
        prepare_state(temp.path(), &unavailable, "ar").unwrap();
        assert_eq!(std::fs::read(database).unwrap(), bytes);
        assert_eq!(std::fs::read(unavailable).unwrap(), b"not a directory");
    }

    #[test]
    fn invalid_language_or_folder_never_publishes_partial_database() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("state");
        let downloads = temp.path().join("downloads");
        assert!(prepare_state(&root, &downloads, "xx").is_err());
        assert!(!root.exists() && !downloads.exists());
        std::fs::write(&downloads, b"occupied").unwrap();
        assert!(prepare_state(&root, &downloads, "en").is_err());
        assert!(!root.join("zipzap.sqlite").exists());
    }
}
