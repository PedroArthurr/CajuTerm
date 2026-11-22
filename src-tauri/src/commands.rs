use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use base64::Engine;
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::config::{AppSettings, ConfigBundle, ConfigState, ThemeConfig};
use crate::pty::PtyManager;

/// Estado que memoriza a geometria anterior e o atalho global atual do Modo Quake.
pub struct QuakeState {
    pub active: Mutex<bool>,
    pub prev_bounds: Mutex<Option<(i32, i32, u32, u32)>>,
    pub current_shortcut: Mutex<Option<String>>,
}

impl QuakeState {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(false),
            prev_bounds: Mutex::new(None),
            current_shortcut: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    pty: State<'_, Arc<PtyManager>>,
    shell: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    pty.spawn(app, shell, args, cwd, env, cols, rows)
}

#[tauri::command]
pub fn pty_write(
    pty: State<'_, Arc<PtyManager>>,
    id: u32,
    data: String,
) -> Result<(), String> {
    pty.write(id, &data)
}

#[tauri::command]
pub fn pty_resize(
    pty: State<'_, Arc<PtyManager>>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty.resize(id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(pty: State<'_, Arc<PtyManager>>, id: u32) -> Result<(), String> {
    pty.kill(id)
}

#[tauri::command]
pub fn get_config_bundle(config: State<'_, Arc<ConfigState>>) -> Result<ConfigBundle, String> {
    config.load_bundle()
}

#[tauri::command]
pub fn save_settings(
    config: State<'_, Arc<ConfigState>>,
    settings: AppSettings,
) -> Result<ConfigBundle, String> {
    config.save_settings(&settings)
}

#[tauri::command]
pub fn save_raw_settings(
    config: State<'_, Arc<ConfigState>>,
    raw_json: String,
) -> Result<ConfigBundle, String> {
    config.save_raw_settings(&raw_json)
}

#[tauri::command]
pub fn save_custom_css(
    config: State<'_, Arc<ConfigState>>,
    css: String,
) -> Result<ConfigBundle, String> {
    config.save_custom_css(&css)
}

#[tauri::command]
pub fn save_theme(
    config: State<'_, Arc<ConfigState>>,
    theme: ThemeConfig,
) -> Result<ConfigBundle, String> {
    config.save_theme(&theme)
}

#[tauri::command]
pub fn delete_theme(
    config: State<'_, Arc<ConfigState>>,
    theme_id: String,
) -> Result<ConfigBundle, String> {
    config.delete_theme(&theme_id)
}

#[tauri::command]
pub fn install_font_base64(
    config: State<'_, Arc<ConfigState>>,
    file_name: String,
    base64_data: String,
) -> Result<ConfigBundle, String> {
    let payload = base64_data
        .split(',')
        .next_back()
        .unwrap_or(base64_data.as_str());
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("Falha ao decodificar arquivo de fonte: {e}"))?;
    config.save_font_bytes(&file_name, &bytes)
}

#[tauri::command]
pub fn open_config_dir(config: State<'_, Arc<ConfigState>>) -> Result<(), String> {
    let dir = config.config_dir.to_string_lossy().into_owned();
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Falha ao abrir pasta no Explorer: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dir;
        Ok(())
    }
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Somente URLs http:// ou https:// são permitidas".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .spawn()
            .map_err(|e| format!("Falha ao abrir URL externa: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn apply_window_vibrancy(
    window: WebviewWindow,
    vibrancy: String,
    tint_rgba: Option<[u8; 4]>,
) -> Result<(), String> {
    apply_vibrancy_to_window(&window, &vibrancy, tint_rgba)
}

pub fn apply_vibrancy_to_window(
    window: &WebviewWindow,
    vibrancy: &str,
    tint_rgba: Option<[u8; 4]>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = window_vibrancy::clear_acrylic(window);
        let _ = window_vibrancy::clear_mica(window);

        match vibrancy {
            "acrylic" => {
                let rgba = tint_rgba.unwrap_or([11, 7, 22, 175]);
                let _ = window_vibrancy::apply_acrylic(
                    window,
                    Some((rgba[0], rgba[1], rgba[2], rgba[3])),
                );
            }
            "mica" => {
                let _ = window_vibrancy::apply_mica(window, Some(true));
            }
            _ => {}
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, vibrancy, tint_rgba);
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_quake_mode(
    app: AppHandle,
    quake: State<'_, Arc<QuakeState>>,
) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Janela principal não encontrada".to_string())?;
    toggle_quake_window(&window, &quake)
}

pub fn toggle_quake_window(window: &WebviewWindow, quake: &QuakeState) -> Result<bool, String> {
    let is_visible = window.is_visible().unwrap_or(true);
    let mut is_quake = quake.active.lock();

    if *is_quake && is_visible {
        let _ = window.hide();
        return Ok(false);
    }

    if !*is_quake {
        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
            *quake.prev_bounds.lock() = Some((pos.x, pos.y, size.width, size.height));
        }
    }

    if let Ok(Some(monitor)) = window.current_monitor() {
        let m_pos = monitor.position();
        let m_size = monitor.size();
        let target_w = m_size.width;
        let target_h = ((m_size.height as f32) * 0.52).round() as u32;

        let _ = window.set_always_on_top(true);
        let _ = window.set_size(PhysicalSize::new(target_w, target_h.max(320)));
        let _ = window.set_position(PhysicalPosition::new(m_pos.x, m_pos.y));
    }

    let _ = window.show();
    let _ = window.set_focus();
    *is_quake = true;
    Ok(true)
}

#[tauri::command]
pub fn exit_quake_mode(
    app: AppHandle,
    quake: State<'_, Arc<QuakeState>>,
    always_on_top: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Janela principal não encontrada".to_string())?;
    *quake.active.lock() = false;
    let _ = window.set_always_on_top(always_on_top);
    if let Some((x, y, w, h)) = quake.prev_bounds.lock().take() {
        let _ = window.set_size(PhysicalSize::new(w, h));
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    Ok(())
}

#[tauri::command]
pub fn update_quake_shortcut(
    app: AppHandle,
    quake: State<'_, Arc<QuakeState>>,
    shortcut: String,
) -> Result<(), String> {
    register_quake_shortcut(&app, &quake, &shortcut)
}

pub fn register_quake_shortcut(
    app: &AppHandle,
    quake: &QuakeState,
    shortcut_str: &str,
) -> Result<(), String> {
    let gs = app.global_shortcut();

    if let Some(prev) = quake.current_shortcut.lock().take() {
        if let Ok(parsed) = prev.parse::<Shortcut>() {
            let _ = gs.unregister(parsed);
        }
    }

    let trimmed = shortcut_str.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let parsed: Shortcut = trimmed
        .parse()
        .map_err(|e| format!("Atalho global inválido '{trimmed}': {e}"))?;

    gs.register(parsed)
        .map_err(|e| format!("Não foi possível registrar atalho global '{trimmed}': {e}"))?;

    *quake.current_shortcut.lock() = Some(trimmed.to_string());
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickPathEntry {
    pub label: String,
    pub path: String,
    pub group: String,
}

#[tauri::command]
pub fn list_quick_paths() -> Result<Vec<QuickPathEntry>, String> {
    let mut entries = vec![
        QuickPathEntry {
            label: "virtus".to_string(),
            path: "Y:/virtus/virtus".to_string(),
            group: "Favoritos".to_string(),
        },
        QuickPathEntry {
            label: "Github-PA".to_string(),
            path: "Y:/Github-PA".to_string(),
            group: "Favoritos".to_string(),
        },
    ];

    let github_pa = Path::new("Y:/Github-PA");
    if github_pa.is_dir() {
        let mut subdirs: Vec<QuickPathEntry> = Vec::new();
        if let Ok(read_dir) = std::fs::read_dir(github_pa) {
            for item in read_dir.flatten() {
                let p = item.path();
                if p.is_dir() {
                    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                        subdirs.push(QuickPathEntry {
                            label: name.to_string(),
                            path: format!("Y:/Github-PA/{name}"),
                            group: "Y:/Github-PA".to_string(),
                        });
                    }
                }
            }
        }
        subdirs.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
        entries.extend(subdirs);
    }

    Ok(entries)
}
