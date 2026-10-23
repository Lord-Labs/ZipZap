use std::{
    io::Write,
    process::{Command, Stdio},
};

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
