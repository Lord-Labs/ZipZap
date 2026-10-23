use std::{
    io::{Read, Write},
    os::windows::{
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    path::Path,
    process::{Child, Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};
use zipzap_core::Manager;

const UNAVAILABLE: &str =
    "Public combined video unavailable; update or repair ZipZap and check supported sources";

fn own_tree(child: &mut Child) -> Result<OwnedHandle, String> {
    // The fixed Python bootstrap cannot start extraction/Node until the parent releases stdin.
    unsafe {
        let raw = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if raw.is_null() {
            return Err(UNAVAILABLE.into());
        }
        let job = OwnedHandle::from_raw_handle(raw);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            raw,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of_val(&limits) as u32,
        ) == 0
            || AssignProcessToJobObject(raw, child.as_raw_handle()) == 0
        {
            return Err(UNAVAILABLE.into());
        }
        Ok(job)
    }
}

fn run_tool(
    resources: &Path,
    source: &str,
    stopped: impl Fn() -> bool,
    deadline: Duration,
) -> Result<Vec<u8>, String> {
    let tools = resources.join("media");
    for name in ["python/python.exe", "node/node.exe", "yt-dlp", "resolve.py"] {
        if !std::fs::symlink_metadata(tools.join(name))
            .is_ok_and(|metadata| metadata.file_type().is_file())
        {
            return Err(UNAVAILABLE.into());
        }
    }
    let temporary = tempfile::tempdir().map_err(|_| UNAVAILABLE)?;
    let system_root = std::env::var_os("SystemRoot").ok_or(UNAVAILABLE)?;
    let mut child = Command::new(tools.join("python/python.exe"))
        .arg("-I")
        .args(["-X", "utf8"])
        .arg(tools.join("resolve.py"))
        .arg(source)
        .current_dir(&tools)
        .env_clear()
        .env("SystemRoot", &system_root)
        .env("WINDIR", &system_root)
        .env("PATH", "")
        .env("TEMP", temporary.path())
        .env("TMP", temporary.path())
        .creation_flags(0x0800_0000)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| UNAVAILABLE)?;
    let job = match own_tree(&mut child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let output = child.stdout.take().ok_or(UNAVAILABLE)?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        output.take(32769).read_to_end(&mut bytes).map(|_| bytes)
    });
    let started = Instant::now();
    let result = if child
        .stdin
        .take()
        .ok_or(UNAVAILABLE)?
        .write_all(b"1")
        .is_err()
    {
        Err(UNAVAILABLE.to_owned())
    } else {
        loop {
            if stopped() || started.elapsed() >= deadline {
                break Err(UNAVAILABLE.to_owned());
            }
            match child.try_wait() {
                Ok(Some(status)) => {
                    break if status.success() {
                        Ok(())
                    } else {
                        Err(UNAVAILABLE.to_owned())
                    };
                }
                Err(_) => break Err(UNAVAILABLE.to_owned()),
                Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            }
        }
    };
    drop(job); // Also closes descendants on timeout, cancellation and app process death.
    let _ = child.wait();
    let bytes = reader
        .join()
        .map_err(|_| UNAVAILABLE)?
        .map_err(|_| UNAVAILABLE)?;
    result?;
    if bytes.len() > 32768 {
        return Err(UNAVAILABLE.into());
    }
    Ok(bytes)
}

fn resolved(bytes: &[u8], id: &str) -> Result<(String, String), String> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| UNAVAILABLE)?;
    let codec = |name| {
        value[name].as_str().is_some_and(|codec| {
            !codec.is_empty() && !codec.eq_ignore_ascii_case("none") && codec.len() <= 128
        })
    };
    let url = value["url"].as_str().ok_or(UNAVAILABLE)?;
    if value["id"] != id
        || value["protocol"] != "https"
        || value["ext"] != "mp4"
        || !codec("vcodec")
        || !codec("acodec")
        || value["has_drm"] == true
        || value["is_live"] != false
        || !zipzap_native::video::resolved(url)
    {
        return Err(UNAVAILABLE.into());
    }
    let title: String = value["title"]
        .as_str()
        .unwrap_or("youtube")
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c))
        .take(80)
        .collect();
    let name = format!("{}-{id}.mp4", title.trim_matches([' ', '.']));
    let filename = if zipzap_core::validate_filename(&name).is_ok() {
        name
    } else {
        format!("youtube-{id}.mp4")
    };
    Ok((url.into(), filename))
}

pub async fn resolve(
    resources: &Path,
    source: &str,
    manager: &Arc<Manager>,
    cancellation: &Path,
) -> Result<(String, String), String> {
    let id = zipzap_native::video::youtube_id(source).ok_or(UNAVAILABLE)?;
    let resources = resources.to_owned();
    let source = source.to_owned();
    let manager = Arc::clone(manager);
    let cancellation = cancellation.to_owned();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        run_tool(
            &resources,
            &source,
            || manager.is_stopping() || cancellation.exists(),
            Duration::from_secs(35),
        )
    })
    .await
    .map_err(|_| UNAVAILABLE)??;
    resolved(&bytes, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::PathBuf, sync::OnceLock};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, WAIT_OBJECT_0},
        System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
    };

    fn fixture() -> tempfile::TempDir {
        static BINARY: OnceLock<Vec<u8>> = OnceLock::new();
        let binary=BINARY.get_or_init(|| {
            let temp=tempfile::tempdir().unwrap();let source=temp.path().join("fixture.rs");let exe=temp.path().join("fixture.exe");
            std::fs::write(&source,r#"
use std::{io::{Read,Write},process::Command,time::Duration};
fn main(){
 let args:Vec<_>=std::env::args().collect();
 if args.get(1).map(String::as_str)==Some("--child") {loop{std::thread::sleep(Duration::from_secs(1));}}
 let script=std::path::Path::new(args.iter().find(|value|value.ends_with("resolve.py")).unwrap());let mut byte=[0];std::io::stdin().read_exact(&mut byte).unwrap();assert_eq!(byte,b"1"[..]);
 let mode=std::fs::read_to_string(script).unwrap();
 match mode.as_str(){
  "tree"=>{let child=Command::new(std::env::current_exe().unwrap()).arg("--child").spawn().unwrap();std::fs::write(script.with_extension("pid"),child.id().to_string()).unwrap();loop{std::thread::sleep(Duration::from_secs(1));}},
  "large"=>{std::io::stdout().write_all(&vec![b'x';32769]).unwrap();},
  "error"=>std::process::exit(1),
  _=>{print!("{{\"id\":\"YE7VzlLtp-4\",\"title\":\"../safe:title\",\"url\":\"https://r1.googlevideo.com/video?private=1\",\"protocol\":\"https\",\"ext\":\"mp4\",\"vcodec\":\"avc1\",\"acodec\":\"aac\",\"is_live\":false}}");}
 }
}
"#).unwrap();
            let result=Command::new("rustc").args(["--edition=2024","--crate-name","zipzap_media_fixture"]).arg(source).arg("-o").arg(&exe).creation_flags(0x0800_0000).output().unwrap();
            assert!(result.status.success(),"{}",String::from_utf8_lossy(&result.stderr));std::fs::read(exe).unwrap()
        });
        let temp = tempfile::Builder::new()
            .prefix("zipzap media ")
            .tempdir()
            .unwrap();
        for folder in ["media/python", "media/node"] {
            std::fs::create_dir_all(temp.path().join(folder)).unwrap();
        }
        std::fs::write(temp.path().join("media/python/python.exe"), binary).unwrap();
        std::fs::write(temp.path().join("media/node/node.exe"), b"fixture").unwrap();
        std::fs::write(temp.path().join("media/yt-dlp"), b"fixture").unwrap();
        std::fs::write(temp.path().join("media/resolve.py"), b"json").unwrap();
        temp
    }
    fn child_stopped(marker: PathBuf) {
        let pid = std::fs::read_to_string(marker).unwrap().parse().unwrap();
        unsafe {
            let handle = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
            if !handle.is_null() {
                assert_eq!(WaitForSingleObject(handle, 3000), WAIT_OBJECT_0);
                CloseHandle(handle);
            }
        }
    }
    #[test]
    fn process_barrier_output_bounds_and_deadline_own_the_whole_child_tree() {
        let temp = fixture();
        let root = temp.path();
        let bytes = run_tool(
            root,
            "https://www.youtube.com/watch?v=YE7VzlLtp-4",
            || false,
            Duration::from_secs(5),
        )
        .unwrap();
        let (_, name) = resolved(&bytes, "YE7VzlLtp-4").unwrap();
        assert!(zipzap_core::validate_filename(&name).is_ok());
        assert!(!name.contains('/'));
        for mode in ["large", "error"] {
            std::fs::write(root.join("media/resolve.py"), mode).unwrap();
            assert_eq!(
                run_tool(root, "fixture", || false, Duration::from_secs(5)).unwrap_err(),
                UNAVAILABLE
            );
        }
        std::fs::write(root.join("media/resolve.py"), b"tree").unwrap();
        assert_eq!(
            run_tool(root, "fixture", || false, Duration::from_millis(700)).unwrap_err(),
            UNAVAILABLE
        );
        child_stopped(root.join("media/resolve.pid"));
    }
    #[test]
    fn stopping_and_missing_resources_are_safe_and_leave_no_running_descendant() {
        let temp = fixture();
        let root = temp.path();
        std::fs::write(root.join("media/resolve.py"), b"tree").unwrap();
        let marker = root.join("media/resolve.pid");
        let started = Instant::now();
        assert_eq!(
            run_tool(root, "fixture", || marker.exists(), Duration::from_secs(5)).unwrap_err(),
            UNAVAILABLE
        );
        assert!(started.elapsed() < Duration::from_secs(5));
        child_stopped(marker);
        std::fs::remove_file(root.join("media/node/node.exe")).unwrap();
        assert_eq!(
            run_tool(root, "fixture", || false, Duration::from_secs(5)).unwrap_err(),
            UNAVAILABLE
        );
    }
    #[test]
    fn metadata_cannot_select_other_sites_ids_protected_or_separate_tracks() {
        let base = serde_json::json!({"id":"YE7VzlLtp-4","title":"safe","url":"https://r1.googlevideo.com/video?secret=1","protocol":"https","ext":"mp4","vcodec":"avc1","acodec":"aac","is_live":false});
        for (key, value) in [
            ("id", serde_json::json!("different-id")),
            ("url", serde_json::json!("https://evil.example/file.mp4")),
            ("url", serde_json::json!("http://r1.googlevideo.com/file")),
            ("acodec", serde_json::json!("none")),
            ("vcodec", serde_json::json!("")),
            ("protocol", serde_json::json!("m3u8_native")),
            ("is_live", serde_json::json!(true)),
            ("has_drm", serde_json::json!(true)),
        ] {
            let mut value_changed = base.clone();
            value_changed[key] = value;
            assert_eq!(
                resolved(&serde_json::to_vec(&value_changed).unwrap(), "YE7VzlLtp-4").unwrap_err(),
                UNAVAILABLE
            );
        }
        assert!(
            resolved(b"malformed ?token=private", "YE7VzlLtp-4")
                .unwrap_err()
                .find("private")
                .is_none()
        );
    }

    #[test]
    fn job_parent_process_fixture() {
        if let Some(root) = std::env::var_os("ZIPZAP_TEST_MEDIA_PARENT") {
            let _ = run_tool(
                Path::new(&root),
                "fixture",
                || false,
                Duration::from_secs(30),
            );
        }
    }

    #[test]
    fn parent_process_death_closes_the_job_and_its_js_descendant() {
        let temp = fixture();
        let root = temp.path();
        std::fs::write(root.join("media/resolve.py"), b"tree").unwrap();
        let mut parent = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "media::tests::job_parent_process_fixture",
                "--nocapture",
            ])
            .env("ZIPZAP_TEST_MEDIA_PARENT", root)
            .creation_flags(0x0800_0000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let marker = root.join("media/resolve.pid");
        for _ in 0..100 {
            if marker.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let appeared = marker.exists();
        let _ = parent.kill();
        let _ = parent.wait();
        assert!(appeared, "Job fixture did not start");
        child_stopped(marker);
    }
}
