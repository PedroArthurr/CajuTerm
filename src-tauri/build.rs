use std::path::{Path, PathBuf};

fn main() {
    stage_conpty();
    tauri_build::build()
}

/// ConPTY embutido no Windows (kernel32) engole DECSET de mouse (?1000h/?1006h): TUIs como
/// Claude Code/vim/btop ficam sem clique. portable-pty prefere um `conpty.dll` + `OpenConsole.exe`
/// ao lado do executável; copia a versão vendorizada (NuGet Microsoft.Windows.Console.ConPTY)
/// para target/<profile> em dev. No instalador, vão via `bundle.resources` (tauri.conf.json).
fn stage_conpty() {
    println!("cargo:rerun-if-changed=vendor/conpty");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("x86_64") => "x64",
        Ok("aarch64") => "arm64",
        _ => return,
    };
    let src = Path::new("vendor/conpty").join(arch);
    // OUT_DIR = target/<profile>/build/<pkg>-<hash>/out
    let Some(profile_dir) = std::env::var_os("OUT_DIR")
        .map(PathBuf::from)
        .and_then(|p| p.ancestors().nth(3).map(Path::to_path_buf))
    else {
        return;
    };
    for name in ["conpty.dll", "OpenConsole.exe"] {
        let from = src.join(name);
        let to = profile_dir.join(name);
        let same = matches!(
            (std::fs::metadata(&from), std::fs::metadata(&to)),
            (Ok(a), Ok(b)) if a.len() == b.len()
        );
        // Em uso por uma instância aberta (hot reload): mantém a cópia existente
        if !same {
            if let Err(e) = std::fs::copy(&from, &to) {
                println!("cargo:warning=Falha ao copiar {name} para {}: {e}", to.display());
            }
        }
    }
}
