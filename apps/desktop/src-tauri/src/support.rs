use std::{io::Write, path::Path};

pub fn save(path: &Path, preview: &str) -> Result<(), String> {
    if preview.len() > 8192 {
        return Err("Support summary exceeds the size limit".into());
    }
    let parent = path.parent().ok_or("Missing export folder")?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "Could not create support export")?;
    temporary
        .write_all(preview.as_bytes())
        .map_err(|_| "Could not write support export")?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| "Could not sync support export")?;
    temporary.persist_noclobber(path).map_err(
        |_| "Could not save support export; choose a new filename and check folder access",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_keeps_exact_preview_and_preserves_existing_files_on_failure() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("support.json");
        let preview = "{\"format_version\":1,\"counts\":{\"jobs\":2}}";
        save(&path, preview).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), preview);
        assert!(save(&path, "replacement").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), preview);
        assert!(save(&folder.path().join("missing").join("support.json"), preview).is_err());
        assert!(save(&folder.path().join("large.json"), &"x".repeat(8193)).is_err());
        assert!(save(folder.path(), preview).is_err());
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }
}
