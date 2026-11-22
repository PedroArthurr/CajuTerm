use std::collections::HashMap;
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
    pub profiles: Vec<ProfileConfig>,
    pub keybindings: KeybindingsConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

pub struct ConfigState {
    pub config_dir: PathBuf,
    pub lock: Arc<Mutex<()>>,
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
        }
    }
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
            fs::write(&settings_path, json)
                .map_err(|e| format!("Falha ao gravar settings.json inicial: {e}"))?;
        }

        let css_path = config_dir.join("custom.css");
        if !css_path.exists() {
            fs::write(&css_path, DEFAULT_CUSTOM_CSS)
                .map_err(|e| format!("Falha ao gravar custom.css inicial: {e}"))?;
        }

        for theme in builtin_themes() {
            let theme_path = themes_dir.join(format!("{}.json", sanitize_id(&theme.id)));
            if !theme_path.exists() {
                if let Ok(json) = serde_json::to_string_pretty(&theme) {
                    let _ = fs::write(theme_path, json);
                }
            }
        }

        Ok(Self {
            config_dir,
            lock: Arc::new(Mutex::new(())),
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

    /// Lê settings.json, custom.css, temas e fontes do disco em um pacote único.
    pub fn load_bundle(&self) -> Result<ConfigBundle, String> {
        let _guard = self.lock.lock();

        let raw_settings_json = match fs::read_to_string(self.settings_path()) {
            Ok(content) => content,
            Err(_) => serde_json::to_string_pretty(&AppSettings::default())
                .map_err(|e| format!("Erro interno ao serializar settings: {e}"))?,
        };

        let settings: AppSettings = serde_json::from_str(&raw_settings_json)
            .unwrap_or_else(|_| AppSettings::default());

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
        })
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<ConfigBundle, String> {
        {
            let _guard = self.lock.lock();
            let json = serde_json::to_string_pretty(settings)
                .map_err(|e| format!("Falha ao serializar configurações: {e}"))?;
            fs::write(self.settings_path(), json)
                .map_err(|e| format!("Falha ao salvar settings.json: {e}"))?;
        }
        self.load_bundle()
    }

    pub fn save_raw_settings(&self, raw_json: &str) -> Result<ConfigBundle, String> {
        let parsed: AppSettings = serde_json::from_str(raw_json)
            .map_err(|e| format!("JSON inválido em settings.json: {e}"))?;
        self.save_settings(&parsed)
    }

    pub fn save_custom_css(&self, css: &str) -> Result<ConfigBundle, String> {
        {
            let _guard = self.lock.lock();
            fs::write(self.custom_css_path(), css)
                .map_err(|e| format!("Falha ao salvar custom.css: {e}"))?;
        }
        self.load_bundle()
    }

    pub fn save_theme(&self, theme: &ThemeConfig) -> Result<ConfigBundle, String> {
        {
            let _guard = self.lock.lock();
            let file_name = format!("{}.json", sanitize_id(&theme.id));
            let path = self.themes_dir().join(file_name);
            let json = serde_json::to_string_pretty(theme)
                .map_err(|e| format!("Falha ao serializar tema: {e}"))?;
            fs::write(path, json).map_err(|e| format!("Falha ao salvar tema: {e}"))?;
        }
        self.load_bundle()
    }

    pub fn delete_theme(&self, theme_id: &str) -> Result<ConfigBundle, String> {
        {
            let _guard = self.lock.lock();
            let path = self.themes_dir().join(format!("{}.json", sanitize_id(theme_id)));
            if path.exists() {
                fs::remove_file(path).map_err(|e| format!("Falha ao remover tema: {e}"))?;
            }
        }
        self.load_bundle()
    }

    pub fn save_font_bytes(&self, file_name: &str, bytes: &[u8]) -> Result<ConfigBundle, String> {
        {
            let _guard = self.lock.lock();
            let safe_name = Path::new(file_name)
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| "Nome de arquivo de fonte inválido".to_string())?;
            let path = self.fonts_dir().join(safe_name);
            fs::write(path, bytes).map_err(|e| format!("Falha ao salvar fonte: {e}"))?;
        }
        self.load_bundle()
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

    fn load_fonts_unlocked(&self) -> Vec<FontAsset> {
        use base64::Engine;

        let mut fonts = Vec::new();
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

                if let (Some(stem), Some(file_name), Ok(bytes)) = (
                    path.file_stem().and_then(|s| s.to_str()),
                    path.file_name().and_then(|s| s.to_str()),
                    fs::read(&path),
                ) {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
                    fonts.push(FontAsset {
                        family: stem.to_string(),
                        file_name: file_name.to_string(),
                        data_url: format!("data:{mime};base64,{encoded}"),
                    });
                }
            }
        }
        fonts
    }
}

/// Inicia watcher `notify` com debounce de 80 ms para hot-reload de settings.json, custom.css, temas e fontes.
pub fn start_config_watcher(app: AppHandle, state: Arc<ConfigState>) -> Result<(), String> {
    let watch_dir = state.config_dir.clone();
    let (tx, rx) = mpsc::channel::<()>();

    let mut watcher = recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                    let _ = tx.send(());
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

            loop {
                if rx.recv().is_err() {
                    break;
                }

                let mut deadline = Instant::now() + debounce;
                loop {
                    let now = Instant::now();
                    if now >= deadline {
                        break;
                    }
                    match rx.recv_timeout(deadline - now) {
                        Ok(()) => deadline = Instant::now() + debounce,
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }

                if let Ok(bundle) = state.load_bundle() {
                    let _ = app.emit("config-reloaded", bundle);
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
