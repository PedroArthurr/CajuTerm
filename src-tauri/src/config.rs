use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use notify::{recommended_watcher, EventKind, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeColors {
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    pub cursor_accent: String,
    pub selection_background: String,
    pub black: String,
    pub red: String,
    pub green: String,
    pub yellow: String,
    pub blue: String,
    pub magenta: String,
    pub cyan: String,
    pub white: String,
    pub bright_black: String,
    pub bright_red: String,
    pub bright_green: String,
    pub bright_yellow: String,
    pub bright_blue: String,
    pub bright_magenta: String,
    pub bright_cyan: String,
    pub bright_white: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeConfig {
    pub id: String,
    pub name: String,
    pub category: String,
    pub accent: String,
    pub accent_secondary: String,
    pub ui_surface: String,
    pub ui_border: String,
    pub colors: ThemeColors,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundConfig {
    pub mode: String, // "solid" | "gradient" | "image" | "video"
    pub gradient: String,
    pub media_data_url: String,
    pub media_name: String,
    pub media_opacity: f32,
    pub media_blur: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShaderConfig {
    pub enabled: bool,
    pub scanlines: bool,
    pub scanlines_intensity: f32,
    pub curvature: bool,
    pub curvature_intensity: f32,
    pub bloom: bool,
    pub bloom_intensity: f32,
    pub chromatic_aberration: bool,
    pub chromatic_intensity: f32,
    pub noise: bool,
    pub noise_intensity: f32,
    pub flicker: bool,
    pub flicker_intensity: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorConfig {
    pub style: String, // "block" | "bar" | "underline"
    pub blink: bool,
    pub pulse: bool,
    pub trail: bool,
    pub trail_color: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationConfig {
    pub theme_transition_ms: u32,
    pub tab_fade: bool,
    pub typing_particles: bool,
    pub particle_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct SoundConfig {
    pub enabled: bool,
    pub preset: String, // "cyberpunk" | "arcade" | "minimal" | "scifi"
    pub volume: f32,
    pub message_end: bool,
    pub idle_threshold_ms: u32,
    pub bell: bool,
    pub error_alert: bool,
    pub reactions: bool,
    pub typing_tick: bool,
    pub snippet_send: bool,
}

impl Default for SoundConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            preset: "cyberpunk".to_string(),
            volume: 0.55,
            message_end: true,
            idle_threshold_ms: 1100,
            bell: true,
            error_alert: true,
            reactions: true,
            typing_tick: false,
            snippet_send: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct SnippetItem {
    pub id: String,
    pub label: String,
    pub command: String,
    pub category: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    pub aliases: Vec<String>,
    pub auto_enter: bool,
    pub confirm: bool,
}

impl Default for SnippetItem {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            command: String::new(),
            category: "Custom".to_string(),
            description: String::new(),
            agent: None,
            aliases: Vec::new(),
            auto_enter: true,
            confirm: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileConfig {
    pub id: String,
    pub name: String,
    pub shell: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub theme_id: Option<String>,
    pub env: HashMap<String, String>,
    pub shortcut: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingsConfig {
    pub new_tab: String,
    pub close_tab: String,
    pub next_tab: String,
    pub prev_tab: String,
    pub split_vertical: String,
    pub split_horizontal: String,
    pub close_pane: String,
    pub focus_left: String,
    pub focus_right: String,
    pub focus_up: String,
    pub focus_down: String,
    pub find: String,
    pub command_palette: String,
    pub open_settings: String,
    pub toggle_always_on_top: String,
    pub quake_global: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AppSettings {
    pub language: String,
    pub theme: String,
    pub default_profile: String,
    pub font_family: String,
    pub font_size: f32,
    pub line_height: f32,
    pub ligatures: bool,
    pub scrollback: u32,
    pub opacity: f32,
    pub blur: f32,
    pub vibrancy: String, // "acrylic" | "mica" | "none"
    pub always_on_top: bool,
    pub background: BackgroundConfig,
    pub shaders: ShaderConfig,
    pub cursor: CursorConfig,
    pub animations: AnimationConfig,
    pub sounds: SoundConfig,
    pub confirm_clear: bool,
    pub active_snippet_agent: String,
    pub snippet_usage: HashMap<String, u32>,
    pub custom_snippets: Vec<SnippetItem>,
    pub profiles: Vec<ProfileConfig>,
    pub keybindings: KeybindingsConfig,
    pub copy_on_select: bool,
    /// Pastas do dock de atalhos. Um item terminando em `/*` lista as subpastas daquele diretório.
    pub quick_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontAsset {
    pub family: String,
    pub file_name: String,
    pub data_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigBundle {
    pub config_dir: String,
    pub settings: AppSettings,
    pub raw_settings_json: String,
    pub custom_css: String,
    pub themes: Vec<ThemeConfig>,
    pub fonts: Vec<FontAsset>,
    /// Presente quando settings.json no disco não pôde ser lido/parseado;
    /// nesse caso `settings` contém a última configuração válida (ou os padrões).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings_error: Option<String>,
}

/// Assinatura (nome, tamanho, mtime) dos arquivos de fonte para invalidar o cache base64.
type FontSignature = Vec<(String, u64, Option<std::time::SystemTime>)>;

/// Marcador de escrita própria: hash do conteúdo gravado (`None` = arquivo removido por nós).
type SelfWriteMark = Option<u64>;

pub struct ConfigState {
    pub config_dir: PathBuf,
    pub lock: Arc<Mutex<()>>,
    last_good_settings: Mutex<Option<AppSettings>>,
    self_writes: Mutex<HashMap<String, SelfWriteMark>>,
    font_cache: Mutex<Option<(FontSignature, Vec<FontAsset>)>>,
}

pub const MAX_FONT_BYTES: usize = 20 * 1024 * 1024;
const FONT_EXTENSIONS: [&str; 4] = ["ttf", "otf", "woff", "woff2"];

fn content_hash(bytes: &[u8]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

fn is_temp_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.ends_with(".tmp"))
}

/// Grava `bytes` em `<path>.tmp` e substitui `path` via rename (MoveFileEx REPLACE_EXISTING no Windows).
/// Nunca deixa o arquivo final meio escrito.
fn write_atomic_raw(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "caminho inválido"))?;
    let tmp = path.with_file_name(format!("{file_name}.tmp"));

    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }

    // Retry curto: editores/antivírus podem manter o destino aberto sem FILE_SHARE_DELETE.
    let mut attempt = 0;
    loop {
        match fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(err) if attempt < 5 => {
                let _ = err;
                attempt += 1;
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(err) => {
                let _ = fs::remove_file(&tmp);
                return Err(err);
            }
        }
    }
}

fn sanitize_font_file_name(raw: &str) -> Result<String, String> {
    let base = Path::new(raw.trim())
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Nome de arquivo de fonte inválido".to_string())?;
    let (stem, ext) = base
        .rsplit_once('.')
        .ok_or_else(|| "Arquivo de fonte sem extensão (use .ttf, .otf, .woff ou .woff2)".to_string())?;
    let ext = ext.to_ascii_lowercase();
    if !FONT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "Extensão de fonte não suportada '.{ext}' (use .ttf, .otf, .woff ou .woff2)"
        ));
    }

    let cleaned: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.' | '(' | ')' | '+') {
                c
            } else {
                '_'
            }
        })
        .take(120)
        .collect();
    let cleaned = cleaned.trim_matches(|c: char| c == ' ' || c == '.').to_string();
    if cleaned.is_empty() {
        return Err("Nome de arquivo de fonte inválido".to_string());
    }

    let upper = cleaned.to_ascii_uppercase();
    let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.len() == 4
            && upper.as_bytes()[3].is_ascii_digit());
    let cleaned = if reserved { format!("font-{cleaned}") } else { cleaned };

    Ok(format!("{cleaned}.{ext}"))
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: "pt-BR".to_string(),
            theme: "caju-cyberpunk".to_string(),
            default_profile: "pwsh".to_string(),
            font_family: "'JetBrainsMono Nerd Font', 'Cascadia Code NF', 'Cascadia Mono', Consolas, monospace".to_string(),
            font_size: 14.0,
            line_height: 1.24,
            ligatures: true,
            scrollback: 10000,
            opacity: 0.86,
            blur: 14.0,
            vibrancy: "acrylic".to_string(),
            always_on_top: false,
            background: BackgroundConfig {
                mode: "gradient".to_string(),
                gradient: "radial-gradient(circle at 18% 15%, rgba(255,42,133,0.18), transparent 45%), radial-gradient(circle at 82% 82%, rgba(0,240,255,0.14), transparent 50%)".to_string(),
                media_data_url: String::new(),
                media_name: String::new(),
                media_opacity: 0.35,
                media_blur: 2.0,
            },
            shaders: ShaderConfig {
                enabled: true,
                scanlines: true,
                scanlines_intensity: 0.18,
                curvature: true,
                curvature_intensity: 0.12,
                bloom: true,
                bloom_intensity: 0.35,
                chromatic_aberration: true,
                chromatic_intensity: 0.15,
                noise: true,
                noise_intensity: 0.06,
                flicker: true,
                flicker_intensity: 0.04,
            },
            cursor: CursorConfig {
                style: "block".to_string(),
                blink: true,
                pulse: true,
                trail: true,
                trail_color: "#00f0ff".to_string(),
                color: "#ff2a85".to_string(),
            },
            animations: AnimationConfig {
                theme_transition_ms: 360,
                tab_fade: true,
                typing_particles: true,
                particle_count: 7,
            },
            sounds: SoundConfig::default(),
            confirm_clear: true,
            active_snippet_agent: "agy".to_string(),
            snippet_usage: HashMap::new(),
            custom_snippets: Vec::new(),
            profiles: default_profiles(),
            keybindings: KeybindingsConfig {
                new_tab: "Ctrl+Shift+T".to_string(),
                close_tab: "Ctrl+Shift+W".to_string(),
                next_tab: "Ctrl+Tab".to_string(),
                prev_tab: "Ctrl+Shift+Tab".to_string(),
                split_vertical: "Alt+Shift+D".to_string(),
                split_horizontal: "Alt+Shift+E".to_string(),
                close_pane: "Alt+Shift+W".to_string(),
                focus_left: "Alt+ArrowLeft".to_string(),
                focus_right: "Alt+ArrowRight".to_string(),
                focus_up: "Alt+ArrowUp".to_string(),
                focus_down: "Alt+ArrowDown".to_string(),
                find: "Ctrl+Shift+F".to_string(),
                command_palette: "Ctrl+Shift+P".to_string(),
                open_settings: "Ctrl+,".to_string(),
                toggle_always_on_top: "Ctrl+Shift+A".to_string(),
                quake_global: "CommandOrControl+Backquote".to_string(),
            },
            copy_on_select: false,
            quick_paths: default_quick_paths(),
        }
    }
}

/// Equivalente exato da lista antes fixa em `list_quick_paths`.
pub fn default_quick_paths() -> Vec<String> {
    vec![
        "Y:/virtus/virtus".to_string(),
        "Y:/Github-PA".to_string(),
        "Y:/Github-PA/*".to_string(),
    ]
}

fn default_profiles() -> Vec<ProfileConfig> {
    vec![
        ProfileConfig {
            id: "pwsh".to_string(),
            name: "PowerShell (Auto)".to_string(),
            shell: "auto".to_string(),
            args: vec!["-NoLogo".to_string()],
            cwd: "~".to_string(),
            theme_id: None,
            env: HashMap::new(),
            shortcut: "Ctrl+Alt+1".to_string(),
        },
        ProfileConfig {
            id: "powershell5".to_string(),
            name: "Windows PowerShell 5.1".to_string(),
            shell: "powershell.exe".to_string(),
            args: vec!["-NoLogo".to_string()],
            cwd: "~".to_string(),
            theme_id: Some("tokyo-night-glass".to_string()),
            env: HashMap::new(),
            shortcut: "Ctrl+Alt+2".to_string(),
        },
        ProfileConfig {
            id: "cmd".to_string(),
            name: "Prompt de Comando (CMD)".to_string(),
            shell: "cmd.exe".to_string(),
            args: vec![],
            cwd: "~".to_string(),
            theme_id: Some("amber-crt-1984".to_string()),
            env: HashMap::new(),
            shortcut: "Ctrl+Alt+3".to_string(),
        },
        ProfileConfig {
            id: "wsl".to_string(),
            name: "WSL (Linux)".to_string(),
            shell: "wsl.exe".to_string(),
            args: vec![],
            cwd: "~".to_string(),
            theme_id: Some("matrix-phosphor".to_string()),
            env: HashMap::new(),
            shortcut: "Ctrl+Alt+4".to_string(),
        },
    ]
}

/// Os 6 temas oficiais incluídos no CajuTerm (pelo menos 3 neon).
pub fn builtin_themes() -> Vec<ThemeConfig> {
    vec![
        ThemeConfig {
            id: "caju-cyberpunk".to_string(),
            name: "Caju Cyberpunk".to_string(),
            category: "Neon".to_string(),
            accent: "#ff2a85".to_string(),
            accent_secondary: "#00f0ff".to_string(),
            ui_surface: "rgba(15, 10, 30, 0.78)".to_string(),
            ui_border: "rgba(255, 42, 133, 0.42)".to_string(),
            colors: ThemeColors {
                background: "#0b0716".to_string(),
                foreground: "#eef2ff".to_string(),
                cursor: "#ff2a85".to_string(),
                cursor_accent: "#0b0716".to_string(),
                selection_background: "rgba(255, 42, 133, 0.34)".to_string(),
                black: "#130d24".to_string(),
                red: "#ff2a85".to_string(),
                green: "#18ff9c".to_string(),
                yellow: "#ff9f1c".to_string(),
                blue: "#3d8bfd".to_string(),
                magenta: "#c77dff".to_string(),
                cyan: "#00f0ff".to_string(),
                white: "#e2e8f0".to_string(),
                bright_black: "#5b527a".to_string(),
                bright_red: "#ff5ca8".to_string(),
                bright_green: "#5cffb8".to_string(),
                bright_yellow: "#ffc15e".to_string(),
                bright_blue: "#70a9ff".to_string(),
                bright_magenta: "#e0aaff".to_string(),
                bright_cyan: "#6ef7ff".to_string(),
                bright_white: "#ffffff".to_string(),
            },
        },
        ThemeConfig {
            id: "synthwave-outrun".to_string(),
            name: "Synthwave Outrun".to_string(),
            category: "Neon".to_string(),
            accent: "#ff7edb".to_string(),
            accent_secondary: "#36f9f6".to_string(),
            ui_surface: "rgba(24, 16, 44, 0.80)".to_string(),
            ui_border: "rgba(54, 249, 246, 0.38)".to_string(),
            colors: ThemeColors {
                background: "#161129".to_string(),
                foreground: "#f4eeff".to_string(),
                cursor: "#ff7edb".to_string(),
                cursor_accent: "#161129".to_string(),
                selection_background: "rgba(255, 126, 219, 0.32)".to_string(),
                black: "#1e1638".to_string(),
                red: "#fe4450".to_string(),
                green: "#72f1b8".to_string(),
                yellow: "#fede5d".to_string(),
                blue: "#03edf9".to_string(),
                magenta: "#ff7edb".to_string(),
                cyan: "#36f9f6".to_string(),
                white: "#f4eeff".to_string(),
                bright_black: "#6c5d99".to_string(),
                bright_red: "#ff6e78".to_string(),
                bright_green: "#97ffd1".to_string(),
                bright_yellow: "#fff192".to_string(),
                bright_blue: "#63f5ff".to_string(),
                bright_magenta: "#ffa6e8".to_string(),
                bright_cyan: "#8afcf9".to_string(),
                bright_white: "#ffffff".to_string(),
            },
        },
        ThemeConfig {
            id: "matrix-phosphor".to_string(),
            name: "Matrix Phosphor".to_string(),
            category: "Neon".to_string(),
            accent: "#00ff66".to_string(),
            accent_secondary: "#66ffaa".to_string(),
            ui_surface: "rgba(4, 16, 8, 0.84)".to_string(),
            ui_border: "rgba(0, 255, 102, 0.36)".to_string(),
            colors: ThemeColors {
                background: "#030b05".to_string(),
                foreground: "#b8ffce".to_string(),
                cursor: "#00ff66".to_string(),
                cursor_accent: "#030b05".to_string(),
                selection_background: "rgba(0, 255, 102, 0.28)".to_string(),
                black: "#081c0d".to_string(),
                red: "#ff4d6d".to_string(),
                green: "#00ff66".to_string(),
                yellow: "#b7ff4a".to_string(),
                blue: "#00d48f".to_string(),
                magenta: "#4dffb8".to_string(),
                cyan: "#00ffc8".to_string(),
                white: "#b8ffce".to_string(),
                bright_black: "#28663a".to_string(),
                bright_red: "#ff758f".to_string(),
                bright_green: "#5cff9d".to_string(),
                bright_yellow: "#d4ff80".to_string(),
                bright_blue: "#42f5b9".to_string(),
                bright_magenta: "#85ffd0".to_string(),
                bright_cyan: "#66ffe0".to_string(),
                bright_white: "#e8fff0".to_string(),
            },
        },
        ThemeConfig {
            id: "amber-crt-1984".to_string(),
            name: "Amber CRT 1984".to_string(),
            category: "Retro".to_string(),
            accent: "#ff9e00".to_string(),
            accent_secondary: "#ffd166".to_string(),
            ui_surface: "rgba(22, 13, 4, 0.86)".to_string(),
            ui_border: "rgba(255, 158, 0, 0.38)".to_string(),
            colors: ThemeColors {
                background: "#120a02".to_string(),
                foreground: "#ffcb77".to_string(),
                cursor: "#ff9e00".to_string(),
                cursor_accent: "#120a02".to_string(),
                selection_background: "rgba(255, 158, 0, 0.32)".to_string(),
                black: "#241404".to_string(),
                red: "#ff5e3a".to_string(),
                green: "#c4b23b".to_string(),
                yellow: "#ff9e00".to_string(),
                blue: "#d9822b".to_string(),
                magenta: "#e86f52".to_string(),
                cyan: "#f4b942".to_string(),
                white: "#ffcb77".to_string(),
                bright_black: "#7a4e1d".to_string(),
                bright_red: "#ff8266".to_string(),
                bright_green: "#e3d26b".to_string(),
                bright_yellow: "#ffc145".to_string(),
                bright_blue: "#f2a65a".to_string(),
                bright_magenta: "#ff9b82".to_string(),
                bright_cyan: "#ffd97d".to_string(),
                bright_white: "#fff0d1".to_string(),
            },
        },
        ThemeConfig {
            id: "tokyo-night-glass".to_string(),
            name: "Tokyo Night Glass".to_string(),
            category: "Dark".to_string(),
            accent: "#7aa2f7".to_string(),
            accent_secondary: "#bb9af7".to_string(),
            ui_surface: "rgba(22, 24, 36, 0.80)".to_string(),
            ui_border: "rgba(122, 162, 247, 0.34)".to_string(),
            colors: ThemeColors {
                background: "#131522".to_string(),
                foreground: "#c0caf5".to_string(),
                cursor: "#7aa2f7".to_string(),
                cursor_accent: "#131522".to_string(),
                selection_background: "rgba(122, 162, 247, 0.28)".to_string(),
                black: "#15161e".to_string(),
                red: "#f7768e".to_string(),
                green: "#9ece6a".to_string(),
                yellow: "#e0af68".to_string(),
                blue: "#7aa2f7".to_string(),
                magenta: "#bb9af7".to_string(),
                cyan: "#7dcfff".to_string(),
                white: "#a9b1d6".to_string(),
                bright_black: "#414868".to_string(),
                bright_red: "#ff899d".to_string(),
                bright_green: "#b9f27c".to_string(),
                bright_yellow: "#ffca85".to_string(),
                bright_blue: "#8db2ff".to_string(),
                bright_magenta: "#d2b8ff".to_string(),
                bright_cyan: "#a4e5ff".to_string(),
                bright_white: "#e0e7ff".to_string(),
            },
        },
        ThemeConfig {
            id: "catppuccin-mocha".to_string(),
            name: "Catppuccin Mocha".to_string(),
            category: "Minimal".to_string(),
            accent: "#cba6f7".to_string(),
            accent_secondary: "#f5c2e7".to_string(),
            ui_surface: "rgba(24, 24, 37, 0.84)".to_string(),
            ui_border: "rgba(203, 166, 247, 0.30)".to_string(),
            colors: ThemeColors {
                background: "#181825".to_string(),
                foreground: "#cdd6f4".to_string(),
                cursor: "#f5e0dc".to_string(),
                cursor_accent: "#181825".to_string(),
                selection_background: "rgba(203, 166, 247, 0.28)".to_string(),
                black: "#45475a".to_string(),
                red: "#f38ba8".to_string(),
                green: "#a6e3a1".to_string(),
                yellow: "#f9e2af".to_string(),
                blue: "#89b4fa".to_string(),
                magenta: "#f5c2e7".to_string(),
                cyan: "#94e2d5".to_string(),
                white: "#bac2de".to_string(),
                bright_black: "#585b70".to_string(),
                bright_red: "#f38ba8".to_string(),
                bright_green: "#a6e3a1".to_string(),
                bright_yellow: "#f9e2af".to_string(),
                bright_blue: "#89b4fa".to_string(),
                bright_magenta: "#f5c2e7".to_string(),
                bright_cyan: "#94e2d5".to_string(),
                bright_white: "#a6adc8".to_string(),
            },
        },
    ]
}

const DEFAULT_CUSTOM_CSS: &str = r#"/* =========================================================
 * CajuTerm custom.css — Hot-Reload ativo ao salvar!
 * Exemplos úteis:
 *   .titlebar { letter-spacing: 0.04em; }
 *   .tab-item.active { box-shadow: 0 0 18px var(--caju-accent); }
 * ========================================================= */
"#;

impl ConfigState {
    /// Inicializa o diretório `%APPDATA%\CajuTerm\` (ou equivalente) com todos os artefatos padrão.
    pub fn init() -> Result<Self, String> {
        let base = dirs::config_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."));
        let config_dir = base.join("CajuTerm");

        let themes_dir = config_dir.join("themes");
        let fonts_dir = config_dir.join("fonts");

        fs::create_dir_all(&themes_dir)
            .map_err(|e| format!("Falha ao criar pasta de temas: {e}"))?;
        fs::create_dir_all(&fonts_dir)
            .map_err(|e| format!("Falha ao criar pasta de fontes: {e}"))?;

        let settings_path = config_dir.join("settings.json");
        if !settings_path.exists() {
            let defaults = AppSettings::default();
            let json = serde_json::to_string_pretty(&defaults)
                .map_err(|e| format!("Falha ao serializar settings padrão: {e}"))?;
            write_atomic_raw(&settings_path, json.as_bytes())
                .map_err(|e| format!("Falha ao gravar settings.json inicial: {e}"))?;
        }

        let css_path = config_dir.join("custom.css");
        if !css_path.exists() {
            write_atomic_raw(&css_path, DEFAULT_CUSTOM_CSS.as_bytes())
                .map_err(|e| format!("Falha ao gravar custom.css inicial: {e}"))?;
        }

        for theme in builtin_themes() {
            let theme_path = themes_dir.join(format!("{}.json", sanitize_id(&theme.id)));
            if !theme_path.exists() {
                if let Ok(json) = serde_json::to_string_pretty(&theme) {
                    let _ = write_atomic_raw(&theme_path, json.as_bytes());
                }
            }
        }

        Ok(Self {
            config_dir,
            lock: Arc::new(Mutex::new(())),
            last_good_settings: Mutex::new(None),
            self_writes: Mutex::new(HashMap::new()),
            font_cache: Mutex::new(None),
        })
    }

    pub fn settings_path(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }

    pub fn custom_css_path(&self) -> PathBuf {
        self.config_dir.join("custom.css")
    }

    pub fn themes_dir(&self) -> PathBuf {
        self.config_dir.join("themes")
    }

    pub fn fonts_dir(&self) -> PathBuf {
        self.config_dir.join("fonts")
    }

    fn settings_backup_path(&self) -> PathBuf {
        self.config_dir.join("settings.json.invalid-backup")
    }

    /// Lê settings.json, custom.css, temas e fontes do disco em um pacote único.
    pub fn load_bundle(&self) -> Result<ConfigBundle, String> {
        let _guard = self.lock.lock();
        self.load_bundle_unlocked()
    }

    /// Lista de pastas rápidas configurada (`settings.quickPaths`).
    pub fn quick_paths(&self) -> Vec<String> {
        let _guard = self.lock.lock();
        self.read_settings_unlocked().0.quick_paths
    }

    fn load_bundle_unlocked(&self) -> Result<ConfigBundle, String> {
        let (settings, raw_settings_json, settings_error) = self.read_settings_unlocked();
        let custom_css = fs::read_to_string(self.custom_css_path()).unwrap_or_default();
        let themes = self.load_themes_unlocked();
        let fonts = self.load_fonts_unlocked();

        Ok(ConfigBundle {
            config_dir: self.config_dir.to_string_lossy().into_owned(),
            settings,
            raw_settings_json,
            custom_css,
            themes,
            fonts,
            settings_error,
        })
    }

    /// Retorna (settings efetivas, JSON bruto, erro). Em falha de parse NÃO cai para os padrões:
    /// usa a última configuração válida e sinaliza o erro, preservando o arquivo do usuário.
    fn read_settings_unlocked(&self) -> (AppSettings, String, Option<String>) {
        let fallback = || self.last_good_settings.lock().clone().unwrap_or_default();

        match fs::read_to_string(self.settings_path()) {
            Ok(content) => match serde_json::from_str::<AppSettings>(&content) {
                Ok(settings) => {
                    *self.last_good_settings.lock() = Some(settings.clone());
                    (settings, content, None)
                }
                Err(e) => (
                    fallback(),
                    content,
                    Some(format!("settings.json inválido (mantida a última configuração válida): {e}")),
                ),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let defaults = AppSettings::default();
                let raw = serde_json::to_string_pretty(&defaults).unwrap_or_default();
                (defaults, raw, None)
            }
            Err(e) => {
                let settings = fallback();
                let raw = serde_json::to_string_pretty(&settings).unwrap_or_default();
                (settings, raw, Some(format!("Falha ao ler settings.json: {e}")))
            }
        }
    }

    fn path_key(path: &Path) -> String {
        path.to_string_lossy().replace('/', "\\").to_lowercase()
    }

    /// Grava atomicamente e registra a escrita para o watcher não re-emitir `config-reloaded`.
    fn write_tracked(&self, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        let key = Self::path_key(path);
        self.self_writes.lock().insert(key.clone(), Some(content_hash(bytes)));
        let result = write_atomic_raw(path, bytes);
        if result.is_err() {
            self.self_writes.lock().remove(&key);
        }
        result
    }

    fn remove_tracked(&self, path: &Path) -> std::io::Result<()> {
        let key = Self::path_key(path);
        self.self_writes.lock().insert(key.clone(), None);
        let result = fs::remove_file(path);
        if result.is_err() {
            self.self_writes.lock().remove(&key);
        }
        result
    }

    /// `true` se o estado atual de `path` é exatamente o que o próprio app gravou/removeu.
    fn is_self_write(&self, path: &Path) -> bool {
        let mark = match self.self_writes.lock().get(&Self::path_key(path)) {
            Some(mark) => *mark,
            None => return false,
        };
        match mark {
            Some(hash) => fs::read(path)
                .map(|bytes| content_hash(&bytes) == hash)
                .unwrap_or(false),
            None => !path.exists(),
        }
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<ConfigBundle, String> {
        let _guard = self.lock.lock();
        let json = serde_json::to_string_pretty(settings)
            .map_err(|e| format!("Falha ao serializar configurações: {e}"))?;

        // Se o arquivo atual estiver inválido (ex.: edição manual em andamento), guarda uma cópia
        // antes de sobrescrever, para não perder o conteúdo do usuário.
        let path = self.settings_path();
        if let Ok(current) = fs::read_to_string(&path) {
            if !current.trim().is_empty() && serde_json::from_str::<AppSettings>(&current).is_err() {
                self.write_tracked(&self.settings_backup_path(), current.as_bytes())
                    .map_err(|e| format!("Falha ao salvar backup do settings.json inválido: {e}"))?;
            }
        }

        self.write_tracked(&path, json.as_bytes())
            .map_err(|e| format!("Falha ao salvar settings.json: {e}"))?;
        *self.last_good_settings.lock() = Some(settings.clone());
        self.load_bundle_unlocked()
    }

    pub fn save_raw_settings(&self, raw_json: &str) -> Result<ConfigBundle, String> {
        let parsed: AppSettings = serde_json::from_str(raw_json)
            .map_err(|e| format!("JSON inválido em settings.json: {e}"))?;
        self.save_settings(&parsed)
    }

    pub fn save_custom_css(&self, css: &str) -> Result<ConfigBundle, String> {
        let _guard = self.lock.lock();
        self.write_tracked(&self.custom_css_path(), css.as_bytes())
            .map_err(|e| format!("Falha ao salvar custom.css: {e}"))?;
        self.load_bundle_unlocked()
    }

    pub fn save_theme(&self, theme: &ThemeConfig) -> Result<ConfigBundle, String> {
        let _guard = self.lock.lock();
        let path = self
            .themes_dir()
            .join(format!("{}.json", sanitize_id(&theme.id)));
        let json = serde_json::to_string_pretty(theme)
            .map_err(|e| format!("Falha ao serializar tema: {e}"))?;
        self.write_tracked(&path, json.as_bytes())
            .map_err(|e| format!("Falha ao salvar tema: {e}"))?;
        self.load_bundle_unlocked()
    }

    pub fn delete_theme(&self, theme_id: &str) -> Result<ConfigBundle, String> {
        let _guard = self.lock.lock();
        let path = self
            .themes_dir()
            .join(format!("{}.json", sanitize_id(theme_id)));
        if path.exists() {
            self.remove_tracked(&path)
                .map_err(|e| format!("Falha ao remover tema: {e}"))?;
        }
        self.load_bundle_unlocked()
    }

    pub fn save_font_bytes(&self, file_name: &str, bytes: &[u8]) -> Result<ConfigBundle, String> {
        if bytes.len() > MAX_FONT_BYTES {
            return Err(format!(
                "Arquivo de fonte muito grande ({:.1} MB; limite {} MB)",
                bytes.len() as f64 / (1024.0 * 1024.0),
                MAX_FONT_BYTES / (1024 * 1024)
            ));
        }
        let safe_name = sanitize_font_file_name(file_name)?;

        let _guard = self.lock.lock();
        let path = self.fonts_dir().join(safe_name);
        self.write_tracked(&path, bytes)
            .map_err(|e| format!("Falha ao salvar fonte: {e}"))?;
        self.load_bundle_unlocked()
    }

    fn load_themes_unlocked(&self) -> Vec<ThemeConfig> {
        let mut by_id: HashMap<String, ThemeConfig> = builtin_themes()
            .into_iter()
            .map(|t| (t.id.clone(), t))
            .collect();

        if let Ok(entries) = fs::read_dir(self.themes_dir()) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Ok(raw) = fs::read_to_string(&path) {
                        if let Ok(theme) = serde_json::from_str::<ThemeConfig>(&raw) {
                            by_id.insert(theme.id.clone(), theme);
                        }
                    }
                }
            }
        }

        let mut list: Vec<ThemeConfig> = by_id.into_values().collect();
        list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        list
    }

    /// Fontes como data URLs. O base64 é cacheado e só recalculado quando a assinatura
    /// (nome/tamanho/mtime) da pasta fonts/ muda.
    fn load_fonts_unlocked(&self) -> Vec<FontAsset> {
        use base64::Engine;

        let mut files: Vec<(PathBuf, String, String, &'static str)> = Vec::new();
        let mut signature: FontSignature = Vec::new();

        if let Ok(entries) = fs::read_dir(self.fonts_dir()) {
            for entry in entries.flatten() {
                let path = entry.path();
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.to_ascii_lowercase());

                let mime = match ext.as_deref() {
                    Some("ttf") => "font/ttf",
                    Some("otf") => "font/otf",
                    Some("woff2") => "font/woff2",
                    Some("woff") => "font/woff",
                    _ => continue,
                };

                let (Some(stem), Some(file_name)) = (
                    path.file_stem().and_then(|s| s.to_str()).map(str::to_string),
                    path.file_name().and_then(|s| s.to_str()).map(str::to_string),
                ) else {
                    continue;
                };
                let Ok(meta) = entry.metadata() else { continue };
                if !meta.is_file() {
                    continue;
                }

                signature.push((file_name.clone(), meta.len(), meta.modified().ok()));
                files.push((path, stem, file_name, mime));
            }
        }

        signature.sort();
        files.sort_by(|a, b| a.2.cmp(&b.2));

        if let Some((cached_sig, cached_fonts)) = self.font_cache.lock().as_ref() {
            if *cached_sig == signature {
                return cached_fonts.clone();
            }
        }

        let mut fonts = Vec::with_capacity(files.len());
        for (path, stem, file_name, mime) in files {
            if let Ok(bytes) = fs::read(&path) {
                let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
                fonts.push(FontAsset {
                    family: stem,
                    file_name,
                    data_url: format!("data:{mime};base64,{encoded}"),
                });
            }
        }

        *self.font_cache.lock() = Some((signature, fonts.clone()));
        fonts
    }
}

/// Inicia watcher `notify` com debounce de 80 ms para hot-reload de settings.json, custom.css, temas e fontes.
/// Ignora arquivos temporários, escritas do próprio app e settings.json inválido (não emite nesse caso).
pub fn start_config_watcher(app: AppHandle, state: Arc<ConfigState>) -> Result<(), String> {
    let watch_dir = state.config_dir.clone();
    let (tx, rx) = mpsc::channel::<Vec<PathBuf>>();

    let mut watcher = recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                    let _ = tx.send(event.paths);
                }
                _ => {}
            }
        }
    })
    .map_err(|e| format!("Falha ao criar file watcher de configurações: {e}"))?;

    watcher
        .watch(&watch_dir, RecursiveMode::Recursive)
        .map_err(|e| format!("Falha ao observar pasta de configurações: {e}"))?;

    std::thread::Builder::new()
        .name("cajuterm-config-watcher".to_string())
        .spawn(move || {
            // Mantém o watcher vivo enquanto a thread existir
            let _keep_alive = watcher;
            let debounce = Duration::from_millis(80);

            while let Ok(first) = rx.recv() {
                let mut changed: HashSet<PathBuf> = first.into_iter().collect();

                let mut deadline = Instant::now() + debounce;
                loop {
                    let now = Instant::now();
                    if now >= deadline {
                        break;
                    }
                    match rx.recv_timeout(deadline - now) {
                        Ok(paths) => {
                            changed.extend(paths);
                            deadline = Instant::now() + debounce;
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }

                let external_change = changed
                    .iter()
                    .any(|p| !is_temp_path(p) && !p.is_dir() && !state.is_self_write(p));
                if !external_change {
                    continue;
                }

                match state.load_bundle() {
                    Ok(bundle) if bundle.settings_error.is_none() => {
                        let _ = app.emit("config-reloaded", bundle);
                    }
                    Ok(bundle) => {
                        eprintln!(
                            "Aviso: hot-reload ignorado: {}",
                            bundle.settings_error.unwrap_or_default()
                        );
                    }
                    Err(err) => eprintln!("Aviso: hot-reload falhou: {err}"),
                }
            }
        })
        .map_err(|e| format!("Falha ao iniciar thread do watcher: {e}"))?;

    Ok(())
}

fn sanitize_id(input: &str) -> String {
    let cleaned: String = input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "custom-theme".to_string()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn font_name_sanitization() {
        assert_eq!(sanitize_font_file_name("..\\..\\evil.TTF").unwrap(), "evil.ttf");
        assert_eq!(sanitize_font_file_name("a/b/My Font<1>.woff2").unwrap(), "My Font_1_.woff2");
        assert_eq!(sanitize_font_file_name("con.otf").unwrap(), "font-con.otf");
        assert!(sanitize_font_file_name("x.exe").is_err());
        assert!(sanitize_font_file_name("..").is_err());
        assert!(sanitize_font_file_name("noext").is_err());
    }

    #[test]
    fn old_settings_without_new_fields_still_load() {
        let s: AppSettings = serde_json::from_str(r#"{"fontSize": 16}"#).unwrap();
        assert_eq!(s.font_size, 16.0);
        assert!(!s.copy_on_select);
        assert_eq!(s.quick_paths, default_quick_paths());
    }
}
