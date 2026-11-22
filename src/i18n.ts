import type { SupportedLanguage } from './types';

export type TranslationKey =
  | 'app.title'
  | 'btn.newTab'
  | 'btn.splitV'
  | 'btn.splitH'
  | 'btn.search'
  | 'btn.palette'
  | 'btn.alwaysOnTop'
  | 'btn.settings'
  | 'search.placeholder'
  | 'search.prev'
  | 'search.next'
  | 'search.close'
  | 'palette.placeholder'
  | 'palette.empty'
  | 'settings.title'
  | 'settings.subtitle'
  | 'settings.tab.appearance'
  | 'settings.tab.background'
  | 'settings.tab.shaders'
  | 'settings.tab.cursor'
  | 'settings.tab.fonts'
  | 'settings.tab.profiles'
  | 'settings.tab.keybindings'
  | 'settings.tab.import'
  | 'settings.tab.css'
  | 'settings.tab.json'
  | 'settings.save'
  | 'settings.openFolder'
  | 'settings.close'
  | 'settings.saved'
  | 'settings.language'
  | 'settings.theme'
  | 'settings.vibrancy'
  | 'settings.opacity'
  | 'settings.blur'
  | 'settings.fontFamily'
  | 'settings.fontSize'
  | 'settings.lineHeight'
  | 'settings.ligatures'
  | 'settings.scrollback'
  | 'settings.themeTransition'
  | 'settings.tabFade'
  | 'settings.bgMode'
  | 'settings.bgGradient'
  | 'settings.bgUpload'
  | 'settings.bgClear'
  | 'settings.bgOpacity'
  | 'settings.bgBlur'
  | 'settings.shaderMaster'
  | 'settings.shaderScanlines'
  | 'settings.shaderCurvature'
  | 'settings.shaderBloom'
  | 'settings.shaderChromatic'
  | 'settings.shaderNoise'
  | 'settings.shaderFlicker'
  | 'settings.cursorStyle'
  | 'settings.cursorBlink'
  | 'settings.cursorPulse'
  | 'settings.cursorTrail'
  | 'settings.cursorColor'
  | 'settings.cursorTrailColor'
  | 'settings.typingParticles'
  | 'settings.particleCount'
  | 'settings.fontUpload'
  | 'settings.fontInstalled'
  | 'settings.profileAdd'
  | 'settings.profileDelete'
  | 'settings.importHint'
  | 'settings.importButton'
  | 'settings.importSuccess'
  | 'settings.importError'
  | 'settings.cssHint'
  | 'settings.jsonHint'
  | 'settings.applyRaw'
  | 'terminal.exited'
  | 'terminal.restartPrompt'
  | 'terminal.copy'
  | 'terminal.paste'
  | 'cmd.newTab'
  | 'cmd.closeTab'
  | 'cmd.splitV'
  | 'cmd.splitH'
  | 'cmd.closePane'
  | 'cmd.find'
  | 'cmd.settings'
  | 'cmd.alwaysOnTop'
  | 'cmd.quakeMode'
  | 'cmd.toggleShaders'
  | 'cmd.clearTerminal'
  | 'cmd.switchTheme';

const DICT: Record<SupportedLanguage, Record<TranslationKey, string>> = {
  'pt-BR': {
    'app.title': 'CajuTerm',
    'btn.newTab': 'Nova Aba',
    'btn.splitV': 'Dividir Verticalmente',
    'btn.splitH': 'Dividir Horizontalmente',
    'btn.search': 'Buscar no Terminal',
    'btn.palette': 'Paleta de Comandos',
    'btn.alwaysOnTop': 'Sempre no Topo',
    'btn.settings': 'Configurações',
    'search.placeholder': 'Buscar no histórico e tela...',
    'search.prev': 'Ocorrência anterior',
    'search.next': 'Próxima ocorrência',
    'search.close': 'Fechar busca (Esc)',
    'palette.placeholder': 'Digite um comando, tema ou perfil...',
    'palette.empty': 'Nenhum comando encontrado.',
    'settings.title': 'Estúdio de Personalização CajuTerm',
    'settings.subtitle': 'Preview ao vivo + Hot-Reload em %APPDATA%\\CajuTerm',
    'settings.tab.appearance': 'Aparência & Temas',
    'settings.tab.background': 'Fundo & Mídia',
    'settings.tab.shaders': 'Shaders WebGL',
    'settings.tab.cursor': 'Cursor & Partículas',
    'settings.tab.fonts': 'Fontes (.ttf/.otf)',
    'settings.tab.profiles': 'Perfis de Shell',
    'settings.tab.keybindings': 'Atalhos',
    'settings.tab.import': 'Importar Temas',
    'settings.tab.css': 'custom.css',
    'settings.tab.json': 'settings.json',
    'settings.save': 'Salvar Tudo',
    'settings.openFolder': 'Abrir Pasta Config',
    'settings.close': 'Fechar',
    'settings.saved': 'Salvo com sucesso!',
    'settings.language': 'Idioma da Interface',
    'settings.theme': 'Tema Ativo',
    'settings.vibrancy': 'Material da Janela (Windows)',
    'settings.opacity': 'Opacidade do Fundo',
    'settings.blur': 'Desfoque CSS (Backdrop Blur)',
    'settings.fontFamily': 'Família da Fonte',
    'settings.fontSize': 'Tamanho da Fonte (px)',
    'settings.lineHeight': 'Altura da Linha',
    'settings.ligatures': 'Habilitar Ligaduras (Nerd Fonts)',
    'settings.scrollback': 'Linhas de Scrollback',
    'settings.themeTransition': 'Transição Suave de Tema (ms)',
    'settings.tabFade': 'Animação de Fade nas Abas',
    'settings.bgMode': 'Modo de Fundo',
    'settings.bgGradient': 'CSS Gradiente',
    'settings.bgUpload': 'Enviar Imagem, GIF ou Vídeo (.mp4/.webm)',
    'settings.bgClear': 'Remover Mídia',
    'settings.bgOpacity': 'Opacidade da Mídia',
    'settings.bgBlur': 'Desfoque da Mídia (px)',
    'settings.shaderMaster': 'Ativar Camada de Shaders WebGL (60 FPS)',
    'settings.shaderScanlines': 'Scanlines CRT',
    'settings.shaderCurvature': 'Curvatura CRT',
    'settings.shaderBloom': 'Glow / Bloom Neon',
    'settings.shaderChromatic': 'Aberração Cromática',
    'settings.shaderNoise': 'Ruído / Grain Analógico',
    'settings.shaderFlicker': 'Flicker CRT Sutil',
    'settings.cursorStyle': 'Formato do Cursor',
    'settings.cursorBlink': 'Piscar Cursor Padrão',
    'settings.cursorPulse': 'Pulse Neon do Cursor',
    'settings.cursorTrail': 'Trail Neon ao Mover',
    'settings.cursorColor': 'Cor do Cursor',
    'settings.cursorTrailColor': 'Cor do Trail Neon',
    'settings.typingParticles': 'Partículas ao Digitar',
    'settings.particleCount': 'Quantidade de Partículas por Tecla',
    'settings.fontUpload': 'Instalar Fonte (.ttf / .otf / .woff2)',
    'settings.fontInstalled': 'Fontes instaladas na pasta fonts/',
    'settings.profileAdd': '+ Novo Perfil',
    'settings.profileDelete': 'Excluir',
    'settings.importHint': 'Cole JSON do Windows Terminal, XML .itermcolors do iTerm2 ou TOML/YAML do Alacritty (ou carregue um arquivo):',
    'settings.importButton': 'Importar e Aplicar Tema',
    'settings.importSuccess': 'Tema importado e aplicado!',
    'settings.importError': 'Não foi possível reconhecer o formato do tema.',
    'settings.cssHint': 'Edite o custom.css com hot-reload automático:',
    'settings.jsonHint': 'Edite o JSON bruto de settings.json:',
    'settings.applyRaw': 'Aplicar & Salvar JSON',
    'terminal.exited': 'Processo encerrado',
    'terminal.restartPrompt': 'Pressione Enter para reiniciar o shell...',
    'terminal.copy': 'Copiar',
    'terminal.paste': 'Colar',
    'cmd.newTab': 'Nova Aba (Perfil Padrão)',
    'cmd.closeTab': 'Fechar Aba Atual',
    'cmd.splitV': 'Dividir Painel Verticalmente',
    'cmd.splitH': 'Dividir Painel Horizontalmente',
    'cmd.closePane': 'Fechar Painel Atual',
    'cmd.find': 'Buscar no Terminal',
    'cmd.settings': 'Abrir Configurações',
    'cmd.alwaysOnTop': 'Alternar Sempre no Topo',
    'cmd.quakeMode': 'Alternar Modo Quake',
    'cmd.toggleShaders': 'Ativar/Desativar Shaders WebGL',
    'cmd.clearTerminal': 'Limpar Buffer do Terminal',
    'cmd.switchTheme': 'Aplicar Tema',
  },
  'en-US': {
    'app.title': 'CajuTerm',
    'btn.newTab': 'New Tab',
    'btn.splitV': 'Split Vertically',
    'btn.splitH': 'Split Horizontally',
    'btn.search': 'Find in Terminal',
    'btn.palette': 'Command Palette',
    'btn.alwaysOnTop': 'Always on Top',
    'btn.settings': 'Settings',
    'search.placeholder': 'Search terminal output...',
    'search.prev': 'Previous match',
    'search.next': 'Next match',
    'search.close': 'Close search (Esc)',
    'palette.placeholder': 'Type a command, theme or profile...',
    'palette.empty': 'No matching commands.',
    'settings.title': 'CajuTerm Customization Studio',
    'settings.subtitle': 'Live preview + Hot-Reload at %APPDATA%\\CajuTerm',
    'settings.tab.appearance': 'Appearance & Themes',
    'settings.tab.background': 'Background & Media',
    'settings.tab.shaders': 'WebGL Shaders',
    'settings.tab.cursor': 'Cursor & Particles',
    'settings.tab.fonts': 'Fonts (.ttf/.otf)',
    'settings.tab.profiles': 'Shell Profiles',
    'settings.tab.keybindings': 'Keybindings',
    'settings.tab.import': 'Import Themes',
    'settings.tab.css': 'custom.css',
    'settings.tab.json': 'settings.json',
    'settings.save': 'Save All',
    'settings.openFolder': 'Open Config Folder',
    'settings.close': 'Close',
    'settings.saved': 'Saved successfully!',
    'settings.language': 'Interface Language',
    'settings.theme': 'Active Theme',
    'settings.vibrancy': 'Window Material (Windows)',
    'settings.opacity': 'Background Opacity',
    'settings.blur': 'CSS Backdrop Blur',
    'settings.fontFamily': 'Font Family',
    'settings.fontSize': 'Font Size (px)',
    'settings.lineHeight': 'Line Height',
    'settings.ligatures': 'Enable Font Ligatures',
    'settings.scrollback': 'Scrollback Lines',
    'settings.themeTransition': 'Smooth Theme Transition (ms)',
    'settings.tabFade': 'Tab Fade Animation',
    'settings.bgMode': 'Background Mode',
    'settings.bgGradient': 'CSS Gradient',
    'settings.bgUpload': 'Upload Image, GIF or Video (.mp4/.webm)',
    'settings.bgClear': 'Clear Media',
    'settings.bgOpacity': 'Media Opacity',
    'settings.bgBlur': 'Media Blur (px)',
    'settings.shaderMaster': 'Enable WebGL Shader Layer (60 FPS)',
    'settings.shaderScanlines': 'CRT Scanlines',
    'settings.shaderCurvature': 'CRT Curvature',
    'settings.shaderBloom': 'Neon Glow / Bloom',
    'settings.shaderChromatic': 'Chromatic Aberration',
    'settings.shaderNoise': 'Analog Noise / Grain',
    'settings.shaderFlicker': 'Subtle CRT Flicker',
    'settings.cursorStyle': 'Cursor Style',
    'settings.cursorBlink': 'Standard Cursor Blink',
    'settings.cursorPulse': 'Neon Cursor Pulse',
    'settings.cursorTrail': 'Neon Cursor Trail',
    'settings.cursorColor': 'Cursor Color',
    'settings.cursorTrailColor': 'Trail Color',
    'settings.typingParticles': 'Typing Particles',
    'settings.particleCount': 'Particles per Keypress',
    'settings.fontUpload': 'Install Font (.ttf / .otf / .woff2)',
    'settings.fontInstalled': 'Installed fonts in fonts/',
    'settings.profileAdd': '+ Add Profile',
    'settings.profileDelete': 'Delete',
    'settings.importHint': 'Paste Windows Terminal JSON, iTerm2 .itermcolors XML, or Alacritty TOML/YAML (or load a file):',
    'settings.importButton': 'Import & Apply Theme',
    'settings.importSuccess': 'Theme imported and applied!',
    'settings.importError': 'Could not recognize theme format.',
    'settings.cssHint': 'Edit custom.css with live hot-reload:',
    'settings.jsonHint': 'Edit raw settings.json directly:',
    'settings.applyRaw': 'Apply & Save JSON',
    'terminal.exited': 'Process exited',
    'terminal.restartPrompt': 'Press Enter to restart shell...',
    'terminal.copy': 'Copy',
    'terminal.paste': 'Paste',
    'cmd.newTab': 'New Tab (Default Profile)',
    'cmd.closeTab': 'Close Current Tab',
    'cmd.splitV': 'Split Pane Vertically',
    'cmd.splitH': 'Split Pane Horizontally',
    'cmd.closePane': 'Close Active Pane',
    'cmd.find': 'Find in Terminal',
    'cmd.settings': 'Open Settings',
    'cmd.alwaysOnTop': 'Toggle Always on Top',
    'cmd.quakeMode': 'Toggle Quake Mode',
    'cmd.toggleShaders': 'Toggle WebGL Shaders',
    'cmd.clearTerminal': 'Clear Terminal Buffer',
    'cmd.switchTheme': 'Apply Theme',
  },
  'es-ES': {
    'app.title': 'CajuTerm',
    'btn.newTab': 'Nueva Pestaña',
    'btn.splitV': 'Dividir Verticalmente',
    'btn.splitH': 'Dividir Horizontalmente',
    'btn.search': 'Buscar en la Terminal',
    'btn.palette': 'Paleta de Comandos',
    'btn.alwaysOnTop': 'Siempre Visible',
    'btn.settings': 'Configuración',
    'search.placeholder': 'Buscar en la terminal...',
    'search.prev': 'Resultado anterior',
    'search.next': 'Siguiente resultado',
    'search.close': 'Cerrar búsqueda (Esc)',
    'palette.placeholder': 'Escribe un comando, tema o perfil...',
    'palette.empty': 'No se encontraron comandos.',
    'settings.title': 'Estudio de Personalización CajuTerm',
    'settings.subtitle': 'Vista previa en vivo + Hot-Reload en %APPDATA%\\CajuTerm',
    'settings.tab.appearance': 'Apariencia y Temas',
    'settings.tab.background': 'Fondo y Multimedia',
    'settings.tab.shaders': 'Shaders WebGL',
    'settings.tab.cursor': 'Cursor y Partículas',
    'settings.tab.fonts': 'Fuentes (.ttf/.otf)',
    'settings.tab.profiles': 'Perfiles de Shell',
    'settings.tab.keybindings': 'Atajos',
    'settings.tab.import': 'Importar Temas',
    'settings.tab.css': 'custom.css',
    'settings.tab.json': 'settings.json',
    'settings.save': 'Guardar Todo',
    'settings.openFolder': 'Abrir Carpeta Config',
    'settings.close': 'Cerrar',
    'settings.saved': '¡Guardado correctamente!',
    'settings.language': 'Idioma de la Interfaz',
    'settings.theme': 'Tema Activo',
    'settings.vibrancy': 'Material de Ventana (Windows)',
    'settings.opacity': 'Opacidad del Fondo',
    'settings.blur': 'Desenfoque CSS',
    'settings.fontFamily': 'Familia Tipográfica',
    'settings.fontSize': 'Tamaño de Fuente (px)',
    'settings.lineHeight': 'Altura de Línea',
    'settings.ligatures': 'Habilitar Ligaduras',
    'settings.scrollback': 'Líneas de Scrollback',
    'settings.themeTransition': 'Transición Suave de Tema (ms)',
    'settings.tabFade': 'Animación Fade en Pestañas',
    'settings.bgMode': 'Modo de Fondo',
    'settings.bgGradient': 'Gradiente CSS',
    'settings.bgUpload': 'Subir Imagen, GIF o Video (.mp4/.webm)',
    'settings.bgClear': 'Quitar Media',
    'settings.bgOpacity': 'Opacidad de Media',
    'settings.bgBlur': 'Desenfoque de Media (px)',
    'settings.shaderMaster': 'Activar Capa de Shaders WebGL (60 FPS)',
    'settings.shaderScanlines': 'Scanlines CRT',
    'settings.shaderCurvature': 'Curvatura CRT',
    'settings.shaderBloom': 'Brillo / Bloom Neón',
    'settings.shaderChromatic': 'Aberración Cromática',
    'settings.shaderNoise': 'Ruido Analógico',
    'settings.shaderFlicker': 'Parpadeo CRT Sutil',
    'settings.cursorStyle': 'Estilo del Cursor',
    'settings.cursorBlink': 'Parpadeo Estándar',
    'settings.cursorPulse': 'Pulso Neón del Cursor',
    'settings.cursorTrail': 'Estela Neón al Mover',
    'settings.cursorColor': 'Color del Cursor',
    'settings.cursorTrailColor': 'Color de la Estela',
    'settings.typingParticles': 'Partículas al Escribir',
    'settings.particleCount': 'Partículas por Tecla',
    'settings.fontUpload': 'Instalar Fuente (.ttf / .otf / .woff2)',
    'settings.fontInstalled': 'Fuentes instaladas en fonts/',
    'settings.profileAdd': '+ Nuevo Perfil',
    'settings.profileDelete': 'Eliminar',
    'settings.importHint': 'Pega JSON de Windows Terminal, XML .itermcolors de iTerm2 o TOML/YAML de Alacritty:',
    'settings.importButton': 'Importar y Aplicar Tema',
    'settings.importSuccess': '¡Tema importado y aplicado!',
    'settings.importError': 'No se pudo reconocer el formato del tema.',
    'settings.cssHint': 'Edita custom.css con hot-reload automático:',
    'settings.jsonHint': 'Edita el JSON directo de settings.json:',
    'settings.applyRaw': 'Aplicar y Guardar JSON',
    'terminal.exited': 'Proceso terminado',
    'terminal.restartPrompt': 'Pulsa Enter para reiniciar el shell...',
    'terminal.copy': 'Copiar',
    'terminal.paste': 'Pegar',
    'cmd.newTab': 'Nueva Pestaña',
    'cmd.closeTab': 'Cerrar Pestaña Actual',
    'cmd.splitV': 'Dividir Verticalmente',
    'cmd.splitH': 'Dividir Horizontalmente',
    'cmd.closePane': 'Cerrar Panel Actual',
    'cmd.find': 'Buscar en la Terminal',
    'cmd.settings': 'Abrir Configuración',
    'cmd.alwaysOnTop': 'Alternar Siempre Visible',
    'cmd.quakeMode': 'Alternar Modo Quake',
    'cmd.toggleShaders': 'Activar/Desactivar Shaders WebGL',
    'cmd.clearTerminal': 'Limpiar Terminal',
    'cmd.switchTheme': 'Aplicar Tema',
  },
};

export function normalizeLang(lang: string | undefined): SupportedLanguage {
  if (lang === 'en-US' || lang === 'es-ES' || lang === 'pt-BR') {
    return lang;
  }
  return 'pt-BR';
}

export function t(key: TranslationKey, lang: string | undefined): string {
  const resolved = normalizeLang(lang);
  return DICT[resolved][key] ?? DICT['pt-BR'][key] ?? key;
}
