use super::*;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct Column {
    pub id: String,
    pub width: u16,
    pub visible: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct ViewPreferences {
    pub appearance: String,
    pub columns: Vec<Column>,
    pub sort: String,
    pub descending: bool,
}

impl Default for ViewPreferences {
    fn default() -> Self {
        serde_json::from_str(include_str!("../../../config/view.json"))
            .expect("valid view defaults")
    }
}

impl ViewPreferences {
    pub(super) fn validate(&self) -> Result<()> {
        let defaults = Self::default();
        if !["light", "dark", "system"].contains(&self.appearance.as_str())
            || !["recent", "filename", "total", "status"].contains(&self.sort.as_str())
            || self.columns.len() != defaults.columns.len()
            || self
                .columns
                .iter()
                .zip(defaults.columns)
                .any(|(column, default)| {
                    column.id != default.id
                        || !(80..=800).contains(&column.width)
                        || (column.id == "filename" && (!column.visible || column.width < 180))
                })
        {
            return Err("Invalid appearance or column preferences".into());
        }
        Ok(())
    }
}
