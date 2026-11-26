use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use base64::Engine;
use parking_lot::Mutex;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::config::{AppSettings, ConfigBundle, ConfigState, ThemeConfig, MAX_FONT_BYTES};
use crate::pty::{PtyEvent, PtyManager};

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

/// Executa trabalho de IO fora da thread principal e do executor async.
async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("Falha interna em tarefa de IO: {e}"))?
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn pty_spawn(
    pty: State<'_, Arc<PtyManager>>,
    shell: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> Result<u32, String> {
    let pty = Arc::clone(pty.inner());
    run_blocking(move || pty.spawn(shell, args, cwd, env, cols, rows, on_event)).await
}

/// Síncrono de propósito (preserva a ordem de chegada): apenas enfileira para a thread de escrita.
#[tauri::command]
pub fn pty_write(
    pty: State<'_, Arc<PtyManager>>,
    id: u32,
    data: String,
) -> Result<(), String> {
    pty.write(id, data)
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
pub async fn pty_kill(pty: State<'_, Arc<PtyManager>>, id: u32) -> Result<(), String> {
    let pty = Arc::clone(pty.inner());
    run_blocking(move || pty.kill(id)).await
}

#[tauri::command]
pub async fn get_config_bundle(
    config: State<'_, Arc<ConfigState>>,
) -> Result<ConfigBundle, String> {
    let config = Arc::clone(config.inner());
    run_blocking(move || config.load_bundle()).await
}

#[tauri::command]
pub async fn save_settings(
    config: State<'_, Arc<ConfigState>>,
    settings: AppSettings,
) -> Result<ConfigBundle, String> {
    let config = Arc::clone(config.inner());
    run_blocking(move || config.save_settings(&settings)).await
}

#[tauri::command]
pub async fn save_raw_settings(
    config: State<'_, Arc<ConfigState>>,
    raw_json: String,
) -> Result<ConfigBundle, String> {
    let config = Arc::clone(config.inner());
    run_blocking(move || config.save_raw_settings(&raw_json)).await
}

#[tauri::command]
pub async fn save_custom_css(
    config: State<'_, Arc<ConfigState>>,
    css: String,
) -> Result<ConfigBundle, String> {
    let config = Arc::clone(config.inner());
    run_blocking(move || config.save_custom_css(&css)).await
}

#[tauri::command]
pub async fn save_theme(
    config: State<'_, Arc<ConfigState>>,
    theme: ThemeConfig,
) -> Result<ConfigBundle, String> {
    let config = Arc::clone(config.inner());
    run_blocking(move || config.save_theme(&theme)).await
}

#[tauri::command]
pub async fn delete_theme(
    config: State<'_, Arc<ConfigState>>,
    theme_id: String,
) -> Result<ConfigBundle, String> {
    let config = Arc::clone(config.inner());
    run_blocking(move || config.delete_theme(&theme_id)).await
}

#[tauri::command]
pub async fn install_font_base64(
    config: State<'_, Arc<ConfigState>>,
    file_name: String,
    base64_data: String,
) -> Result<ConfigBundle, String> {
    let config = Arc::clone(config.inner());
    run_blocking(move || {
        let payload = base64_data
            .split(',')
            .next_back()
            .unwrap_or(base64_data.as_str())
            .trim();
        // Rejeita antes de decodificar: base64 ocupa ~4/3 do tamanho binário.
        if payload.len() / 4 * 3 > MAX_FONT_BYTES + 3 {
            return Err(format!(
                "Arquivo de fonte muito grande (limite {} MB)",
                MAX_FONT_BYTES / (1024 * 1024)
            ));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload)
            .map_err(|e| format!("Falha ao decodificar arquivo de fonte: {e}"))?;
        config.save_font_bytes(&file_name, &bytes)
    })
    .await
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

/// Abre http/https/mailto no handler padrão via ShellExecuteW — sem passar por `cmd.exe`,
/// então `&`, `|`, `^` etc. na URL não são interpretados como comandos.
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(url.trim()).map_err(|e| format!("URL inválida: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {
            if parsed.host_str().is_none_or(str::is_empty) {
                return Err("URL sem host".to_string());
            }
        }
        "mailto" => {}
        _ => return Err("Somente URLs http://, https:// ou mailto: são permitidas".to_string()),
    }

    let target = parsed.to_string();
    run_blocking(move || shell_open(&target)).await
}

#[cfg(target_os = "windows")]
fn shell_open(target: &str) -> Result<(), String> {
    use windows_sys::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let file: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let verb: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

    // SAFETY: ponteiros apontam para buffers UTF-16 terminados em NUL vivos durante a chamada.
    let code = unsafe {
        let hr = CoInitializeEx(
            std::ptr::null(),
            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
        );
        let result = ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        );
        if hr >= 0 {
            CoUninitialize();
        }
        result as isize
    };

    // ShellExecuteW: valores > 32 indicam sucesso.
    if code > 32 {
        Ok(())
    } else {
        Err(format!("Falha ao abrir URL externa (ShellExecute código {code})"))
    }
}

#[cfg(not(target_os = "windows"))]
fn shell_open(_target: &str) -> Result<(), String> {
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
    let trimmed = shortcut_str.trim();
    let prev: Option<Shortcut> = quake
        .current_shortcut
        .lock()
        .clone()
        .and_then(|p| p.parse::<Shortcut>().ok());

    if trimmed.is_empty() {
        if let Some(prev) = prev {
            let _ = gs.unregister(prev);
        }
        *quake.current_shortcut.lock() = None;
        return Ok(());
    }

    // Valida e registra o novo ANTES de soltar o antigo: entrada inválida mantém o atalho atual.
    let parsed: Shortcut = trimmed
        .parse()
        .map_err(|e| format!("Atalho global inválido '{trimmed}': {e}"))?;

    if prev == Some(parsed) {
        *quake.current_shortcut.lock() = Some(trimmed.to_string());
        return Ok(());
    }

    gs.register(parsed)
        .map_err(|e| format!("Não foi possível registrar atalho global '{trimmed}': {e}"))?;

    if let Some(prev) = prev {
        let _ = gs.unregister(prev);
    }

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

/// Lê `settings.quickPaths`. Item comum -> entrada em "Favoritos";
/// item terminando em `/*` -> uma entrada por subpasta, agrupadas pelo diretório raiz.
#[tauri::command]
pub async fn list_quick_paths(
    config: State<'_, Arc<ConfigState>>,
) -> Result<Vec<QuickPathEntry>, String> {
    let config = Arc::clone(config.inner());
    run_blocking(move || Ok(build_quick_paths(&config.quick_paths()))).await
}

fn build_quick_paths(paths: &[String]) -> Vec<QuickPathEntry> {
    let mut entries = Vec::new();

    for raw in paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Some(root) = trimmed
            .strip_suffix("/*")
            .or_else(|| trimmed.strip_suffix("\\*"))
        else {
            let label = Path::new(trimmed)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(trimmed)
                .to_string();
            entries.push(QuickPathEntry {
                label,
                path: trimmed.to_string(),
                group: "Favoritos".to_string(),
            });
            continue;
        };

        let root = root.trim_end_matches(['/', '\\']);
        // "Y:" sozinho significa "diretório atual do drive Y"; força a raiz.
        let group = if root.ends_with(':') {
            format!("{root}/")
        } else {
            root.to_string()
        };
        let dir = Path::new(&group);
        if !dir.is_dir() {
            continue;
        }

        let mut subdirs: Vec<QuickPathEntry> = Vec::new();
        if let Ok(read_dir) = std::fs::read_dir(dir) {
            for item in read_dir.flatten() {
                let p = item.path();
                if p.is_dir() {
                    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                        subdirs.push(QuickPathEntry {
                            label: name.to_string(),
                            path: format!("{root}/{name}"),
                            group: group.clone(),
                        });
                    }
                }
            }
        }
        subdirs.sort_by_key(|e| e.label.to_lowercase());
        entries.extend(subdirs);
    }

    entries
}
