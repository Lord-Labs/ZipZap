use std::{
    io::Write,
    process::{Command, Stdio},
};

#[cfg(windows)]
#[test]
fn app_launch_closes_native_response_pipes_before_the_app_exits() {
    use std::os::windows::process::CommandExt;
    use std::{io::Read, sync::mpsc, time::Duration};
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("pipe_child.rs");
    let done = temp.path().join("done");
    std::fs::write(&source, r#"#![windows_subsystem = "windows"]
fn main() {
    let done=std::env::var_os("ZIPZAP_PIPE_TEST_DONE").unwrap();
    for _ in 0..100 { if std::path::Path::new(&done).exists() {break} std::thread::sleep(std::time::Duration::from_millis(100)); }
}"#).unwrap();
    let fixture = temp.path().join("zipzap-desktop.exe");
    assert!(
        Command::new("rustc")
            .args(["--edition=2024", "--crate-name", "zipzap_pipe_fixture"])
            .arg(&source)
            .arg("-o")
            .arg(&fixture)
            .creation_flags(0x0800_0000)
            .output()
            .unwrap()
            .status
            .success()
    );
    let host = temp.path().join("host.exe");
    std::fs::copy(env!("CARGO_BIN_EXE_zipzap-native"), &host).unwrap();
    let mut child = Command::new(host)
        .env("LOCALAPPDATA", temp.path())
        .env("ZIPZAP_PIPE_TEST_DONE", &done)
        .arg(format!(
            "chrome-extension://{}/",
            zipzap_native::extension_id()
        ))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let payload=br#"{"version":2,"action":"enqueue","id":"ef15f26a-fcc6-46c6-8d56-98d2149565ae","url":"https://example.com/file"}"#;
    let mut input = child.stdin.take().unwrap();
    input
        .write_all(&(payload.len() as u32).to_ne_bytes())
        .unwrap();
    input.write_all(payload).unwrap();
    drop(input);
    let mut stdout = child.stdout.take().unwrap();
    let (send, receive) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).unwrap();
        send.send(bytes).unwrap();
    });
    assert!(child.wait().unwrap().success());
    let early = receive.recv_timeout(Duration::from_secs(3));
    let timely = early.is_ok();
    std::fs::write(done, b"done").unwrap();
    let bytes = early.unwrap_or_else(|_| receive.recv_timeout(Duration::from_secs(5)).unwrap());
    reader.join().unwrap();
    let response: serde_json::Value = serde_json::from_slice(&bytes[4..]).unwrap();
    assert_eq!(response["state"], "received");
    assert!(
        timely,
        "The child app retained the native response pipe after the host exited"
    );
}

#[cfg(windows)]
#[test]
fn copied_uninstall_helper_validates_original_path_and_keeps_foreign_registration() {
    let temp = tempfile::tempdir().unwrap();
    let state = temp.path().join(zipzap_native::APP_ID);
    std::fs::create_dir_all(&state).unwrap();
    let manifest = state.join("native-host.json");
    let original = temp.path().join("zipzap-native.exe");
    let foreign = serde_json::to_vec(&serde_json::json!({"name":zipzap_native::HOST,"path":temp.path().join("another-install/zipzap-native.exe")})).unwrap();
    std::fs::write(&manifest, &foreign).unwrap();
    let helper = temp.path().join("uninstall-helper.exe");
    std::fs::copy(env!("CARGO_BIN_EXE_zipzap-native"), &helper).unwrap();
    let invoke = |path: &std::path::Path| {
        Command::new(&helper)
            .env("LOCALAPPDATA", temp.path())
            .arg("--unregister-native")
            .arg(path)
            .output()
            .unwrap()
    };
    let output = invoke(&original);
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(std::fs::read(&manifest).unwrap(), foreign);
    assert!(
        !invoke(std::path::Path::new("relative/zipzap-native.exe"))
            .status
            .success()
    );
    assert!(!invoke(&temp.path().join("other.exe")).status.success());
    std::fs::write(
        &manifest,
        serde_json::to_vec(&serde_json::json!({"name":zipzap_native::HOST,"path":original}))
            .unwrap(),
    )
    .unwrap();
    assert!(invoke(&original).status.success());
    assert!(!manifest.exists());
    assert!(!state.join("inbox").exists());
}

#[test]
fn missing_app_returns_a_durable_start_failure_without_launching_device_ui() {
    let temp = tempfile::tempdir().unwrap();
    let executable = temp
        .path()
        .join(if cfg!(windows) { "host.exe" } else { "host" });
    std::fs::copy(env!("CARGO_BIN_EXE_zipzap-native"), &executable).unwrap();
    let id = "3ad4aeae-4f21-4273-a607-c0ba6379add6";
    for action in ["enqueue", "status"] {
        let mut value = serde_json::json!({"version":2,"action":action,"id":id});
        if action == "enqueue" {
            value["url"] = "https://example.com/file?token=private".into();
        }
        let bytes = serde_json::to_vec(&value).unwrap();
        let mut child = Command::new(&executable)
            .env("LOCALAPPDATA", temp.path())
            .arg(format!(
                "chrome-extension://{}/",
                zipzap_native::extension_id()
            ))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut input = child.stdin.take().unwrap();
        input
            .write_all(&(bytes.len() as u32).to_ne_bytes())
            .unwrap();
        input.write_all(&bytes).unwrap();
        drop(input);
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        assert!(output.stderr.is_empty());
        assert_eq!(
            u32::from_ne_bytes(output.stdout[..4].try_into().unwrap()) as usize,
            output.stdout.len() - 4
        );
        let response: serde_json::Value = serde_json::from_slice(&output.stdout[4..]).unwrap();
        assert_eq!(response["state"], "rejected");
        assert_eq!(response["code"], "app_start_failed");
        assert_eq!(response["id"], id);
        assert!(!response.to_string().contains("private"));
    }
    let root = temp.path().join(zipzap_native::APP_ID);
    assert!(zipzap_native::result(&root, id).unwrap().is_some());
    assert_eq!(std::fs::read_dir(root.join("inbox")).unwrap().count(), 1);
}

#[test]
fn missing_app_keeps_capture_ambiguous_instead_of_claiming_no_job() {
    let temp = tempfile::tempdir().unwrap();
    let executable = temp
        .path()
        .join(if cfg!(windows) { "host.exe" } else { "host" });
    std::fs::copy(env!("CARGO_BIN_EXE_zipzap-native"), &executable).unwrap();
    let id = "f8039096-8c64-401a-8034-45994be0b93d";
    for action in ["activate", "status"] {
        let bytes =
            serde_json::to_vec(&serde_json::json!({"version":3,"action":action,"id":id})).unwrap();
        let mut child = Command::new(&executable)
            .env("LOCALAPPDATA", temp.path())
            .arg(format!(
                "chrome-extension://{}/",
                zipzap_native::extension_id()
            ))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut input = child.stdin.take().unwrap();
        input
            .write_all(&(bytes.len() as u32).to_ne_bytes())
            .unwrap();
        input.write_all(&bytes).unwrap();
        drop(input);
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        assert!(output.stderr.is_empty());
        let answer: serde_json::Value = serde_json::from_slice(&output.stdout[4..]).unwrap();
        assert_eq!(answer["state"], "received");
    }
    let root = temp.path().join(zipzap_native::APP_ID);
    assert!(zipzap_native::result(&root, id).unwrap().is_none());
    assert!(root.join(format!("inbox/{id}-activate.json")).is_file());
}
