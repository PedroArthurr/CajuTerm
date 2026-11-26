// Impede a abertura de console extra no Windows em builds release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod pty;

use std::sync::Arc;

use tauri::Manager;
use tauri_plugin_global_shortcut::ShortcutState;

use crate::commands::{apply_vibrancy_to_window, register_quake_shortcut, toggle_quake_window, QuakeState};
use crate::config::{start_config_watcher, ConfigState};
use crate::pty::PtyManager;

fn main() {
    let config_state = match ConfigState::init() {
        Ok(state) => Arc::new(state),
        Err(err) => {
            eprintln!("Erro fatal ao inicializar configurações do CajuTerm: {err}");
            return;
        }
    };

    let pty_manager = Arc::new(PtyManager::new());
    let quake_state = Arc::new(QuakeState::new());

    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let (Some(window), Some(quake)) = (
                            app.get_webview_window("main"),
                            app.try_state::<Arc<QuakeState>>(),
                        ) {
                            let _ = toggle_quake_window(&window, &quake);
                        }
                    }
                })
                .build(),
        )
        .manage(Arc::clone(&config_state))
        .manage(Arc::clone(&pty_manager))
        .manage(Arc::clone(&quake_state))
        .setup(move |app| {
            let app_handle = app.handle().clone();

            if let Err(err) = start_config_watcher(app_handle.clone(), Arc::clone(&config_state)) {
                eprintln!("Aviso: hot-reload de arquivos desativado: {err}");
            }

            if let Ok(bundle) = config_state.load_bundle() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = apply_vibrancy_to_window(&window, &bundle.settings.vibrancy, None);
                    let _ = window.set_always_on_top(bundle.settings.always_on_top);
                }

                // Tenta registrar o atalho configurado; se o layout de teclado impedir Backquote, tenta F12.
                let primary = bundle.settings.keybindings.quake_global;
                if register_quake_shortcut(&app_handle, &quake_state, &primary).is_err() {
                    let _ = register_quake_shortcut(&app_handle, &quake_state, "F12");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::pty_has_child,
            commands::get_config_bundle,
            commands::save_settings,
            commands::save_raw_settings,
            commands::save_custom_css,
            commands::save_theme,
            commands::delete_theme,
            commands::install_font_base64,
            commands::open_config_dir,
            commands::open_external_url,
            commands::apply_window_vibrancy,
            commands::toggle_quake_mode,
            commands::exit_quake_mode,
            commands::update_quake_shortcut,
            commands::list_quick_paths,
        ]);

    let app = match builder.build(tauri::generate_context!()) {
        Ok(app) => app,
        Err(err) => {
            eprintln!("Erro ao executar CajuTerm: {err}");
            return;
        }
    };

    app.run(move |_app, event| {
        if let tauri::RunEvent::Exit = event {
            // Encerra shells e fecha os ConPTYs (ClosePseudoConsole) antes do processo sair.
            pty_manager.kill_all();
        }
    });
}
