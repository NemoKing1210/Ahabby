//! Settings commands.

use tauri::State;

use crate::error::Result;
use crate::services::Settings;
use crate::state::AppState;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings> {
    Ok(state.settings())
}

#[tauri::command]
pub async fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings> {
    for path in &settings.extra_scan_paths {
        let trimmed = path.trim();
        if !trimmed.is_empty() && !std::path::Path::new(trimmed).exists() {
            return Err(crate::error::AppError::InvalidInput(format!(
                "scan path does not exist: {trimmed}"
            )));
        }
    }
    state.save_settings(settings)
}
