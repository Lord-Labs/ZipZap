use std::{path::PathBuf, process::Command};

fn command(browser: &str, roots: impl IntoIterator<Item = PathBuf>) -> Result<Command, String> {
    let (relative, page) = match browser {
        "chrome" => (
            "Google/Chrome/Application/chrome.exe",
            "chrome://extensions/",
        ),
        "edge" => (
            "Microsoft/Edge/Application/msedge.exe",
            "edge://extensions/",
        ),
        _ => return Err("Unsupported browser".into()),
    };
    let executable = roots
        .into_iter()
        .filter(|root| root.is_absolute())
        .map(|root| root.join(relative))
        .find(|path| path.is_file())
        .ok_or("Browser unavailable; open its extensions page manually")?;
    let mut command = Command::new(executable);
    command.args(["--new-window", page]);
    Ok(command)
}

pub fn open(browser: &str) -> Result<(), String> {
    use std::{os::windows::process::CommandExt, process::Stdio};
    let roots = ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from);
    command(browser, roots)?
        .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|_| "Cannot open browser extensions page".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_the_selected_browser_and_fixed_page_without_a_shell() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("ملفات Programs");
        for (browser, relative, page) in [
            (
                "chrome",
                "Google/Chrome/Application/chrome.exe",
                "chrome://extensions/",
            ),
            (
                "edge",
                "Microsoft/Edge/Application/msedge.exe",
                "edge://extensions/",
            ),
        ] {
            let executable = root.join(relative);
            std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
            std::fs::write(&executable, b"unexecuted command fixture").unwrap();
            let launch = command(browser, [root.clone()]).unwrap();
            assert_eq!(launch.get_program(), executable.as_os_str());
            assert_eq!(
                launch.get_args().collect::<Vec<_>>(),
                ["--new-window", page]
            );
        }
    }

    #[test]
    fn rejects_arbitrary_browser_commands_and_relative_or_missing_installations() {
        for browser in [
            "",
            "cmd.exe",
            "chrome --load-extension=bad",
            "../chrome",
            "https://example.com",
        ] {
            assert!(command(browser, [PathBuf::from("C:/")]).is_err());
        }
        let temp = tempfile::tempdir().unwrap();
        assert!(command("chrome", [temp.path().to_owned()]).is_err());
        assert!(command("edge", [PathBuf::from("relative")]).is_err());
    }
}
