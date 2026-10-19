use super::*;
use std::collections::HashSet;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub extensions: Vec<String>,
    pub download_folder: Option<String>,
}

pub fn default_categories() -> Vec<Category> {
    serde_json::from_str(include_str!("../../../config/categories.json"))
        .expect("valid built-in categories")
}

pub(super) fn validate(categories: &[Category]) -> Result<()> {
    if categories.is_empty() || categories.len() > 16 {
        return Err("Use between 1 and 16 categories, including Other".into());
    }
    let defaults = default_categories();
    let mut ids = HashSet::new();
    let mut extensions = HashSet::new();
    for category in categories {
        if category.id.is_empty()
            || category.id.len() > 64
            || !category
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            || !ids.insert(category.id.as_str())
            || category.name.len() > 80
            || category.name.trim() != category.name
            || category.name.chars().any(|c| {
                c.is_control() || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            })
            || (category.name.is_empty() && !defaults.iter().any(|item| item.id == category.id))
            || category.extensions.len() > 32
            || (category.id == "other") != category.extensions.is_empty()
            || category
                .download_folder
                .as_ref()
                .is_some_and(|p| p.len() > 32768 || !Path::new(p).is_absolute())
        {
            return Err("Invalid category name, extensions or folder".into());
        }
        for extension in &category.extensions {
            if extension.len() > 64
                || extension.split('.').any(str::is_empty)
                || !extension
                    .chars()
                    .all(|c| c.is_alphanumeric() || ['.', '-', '_'].contains(&c))
            {
                return Err(
                    "Use literal extensions such as zip or tar.gz, without paths or wildcards"
                        .into(),
                );
            }
            if !extensions.insert(extension.to_lowercase()) {
                return Err(
                    "An extension belongs to more than one category; remove the duplicate rule"
                        .into(),
                );
            }
        }
    }
    if !ids.contains("other") {
        return Err("Keep the Other category for unknown extensions".into());
    }
    Ok(())
}

impl Settings {
    pub fn category(&self, filename: &str) -> Option<&Category> {
        let name = filename.to_lowercase();
        self.categories
            .iter()
            .flat_map(|category| {
                category
                    .extensions
                    .iter()
                    .map(move |extension| (category, extension))
            })
            .filter(|(_, extension)| name.ends_with(&format!(".{}", extension.to_lowercase())))
            .max_by_key(|(_, extension)| extension.len())
            .map(|(category, _)| category)
            .or_else(|| {
                self.categories
                    .iter()
                    .find(|category| category.id == "other")
            })
    }
}
