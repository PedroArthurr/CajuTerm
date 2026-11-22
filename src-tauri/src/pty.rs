use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Evento emitido para o frontend com lote (~4 ms) de saída UTF-8 válida do terminal.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutputEvent {
    pub id: u32,
    pub data: String,
}

/// Evento emitido quando o processo do shell dentro do ConPTY é encerrado.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyExitEvent {
    pub id: u32,
    pub exit_code: Option<u32>,
}

struct PtySession {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    killed: Arc<AtomicBool>,
}

/// Gerenciador thread-safe das sessões PTY ativas (id -> sessão ConPTY).
pub struct PtyManager {
    next_id: AtomicU32,
    sessions: Arc<Mutex<HashMap<u32, PtySession>>>,
}

enum ReadChunk {
    Bytes(Vec<u8>),
    Eof(Option<u32>),
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Detecta o executável padrão do shell no Windows:
    /// prioriza `pwsh.exe` (PowerShell 7+) e faz fallback para `powershell.exe` (Windows PowerShell 5.1).
    pub fn resolve_default_shell(requested: Option<&str>) -> String {
        if let Some(shell) = requested {
            let trimmed = shell.trim();
            if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("auto") {
                return trimmed.to_string();
            }
        }

        if let Some(pwsh_path) = find_executable_in_path("pwsh.exe") {
            return pwsh_path.to_string_lossy().into_owned();
        }

        if cfg!(windows) {
            "powershell.exe".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
        }
    }

    /// Spawna uma nova sessão PTY com ConPTY, inicia thread de leitura dedicada
    /// e loop de batching de ~4 ms para envio eficiente via eventos Tauri.
    pub fn spawn(
        &self,
        app: AppHandle,
        shell: Option<String>,
        args: Option<Vec<String>>,
        cwd: Option<String>,
        env: Option<HashMap<String, String>>,
        cols: u16,
        rows: u16,
    ) -> Result<u32, String> {
        let safe_cols = cols.max(2);
        let safe_rows = rows.max(1);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: safe_rows,
                cols: safe_cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Falha ao abrir PTY (ConPTY): {e}"))?;

        let resolved_shell = Self::resolve_default_shell(shell.as_deref());
        let mut cmd = CommandBuilder::new(&resolved_shell);

        if let Some(extra_args) = args {
            for arg in extra_args {
                if !arg.trim().is_empty() {
                    cmd.arg(arg);
                }
            }
        }

        if let Some(dir) = resolve_working_dir(cwd.as_deref()) {
            cmd.cwd(dir);
        }

        // Variáveis essenciais para cores TrueColor, vim, btop, winget e PSReadLine
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "CajuTerm");
        cmd.env("TERM_PROGRAM_VERSION", "1.0.0");
        cmd.env("WT_SESSION", "cajuterm-conpty");

        if let Some(custom_env) = env {
            for (key, value) in custom_env {
                if !key.trim().is_empty() {
                    cmd.env(key, value);
                }
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Falha ao iniciar shell '{resolved_shell}': {e}"))?;

        // Fecha o descritor slave no processo pai para que EOF aconteça corretamente quando o shell sair.
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Falha ao clonar leitor PTY: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Falha ao obter escritor PTY: {e}"))?;

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let child_arc = Arc::new(Mutex::new(child));
        let killed_flag = Arc::new(AtomicBool::new(false));

        let session = PtySession {
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            child: Arc::clone(&child_arc),
            killed: Arc::clone(&killed_flag),
        };

        self.sessions.lock().insert(id, session);

        let (tx, rx) = mpsc::channel::<ReadChunk>();
        let reader_child = Arc::clone(&child_arc);

        // Thread 1: leitura bloqueante dedicada do stream ConPTY
        std::thread::Builder::new()
            .name(format!("cajuterm-pty-read-{id}"))
            .spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            let exit_code = reader_child
                                .lock()
                                .wait()
                                .ok()
                                .map(|status| status.exit_code());
                            let _ = tx.send(ReadChunk::Eof(exit_code));
                            break;
                        }
                        Ok(n) => {
                            if tx.send(ReadChunk::Bytes(buf[..n].to_vec())).is_err() {
                                break;
                            }
                        }
                        Err(_) => {
                            let exit_code = reader_child
                                .lock()
                                .try_wait()
                                .ok()
                                .flatten()
                                .map(|status| status.exit_code());
                            let _ = tx.send(ReadChunk::Eof(exit_code));
                            break;
                        }
                    }
                }
            })
            .map_err(|e| format!("Falha ao criar thread de leitura PTY: {e}"))?;

        let sessions_ref = Arc::clone(&self.sessions);
        let batch_killed = Arc::clone(&killed_flag);

        // Thread 2: agregação (batching) de ~4 ms + decodificação UTF-8 segura entre bordas
        std::thread::Builder::new()
            .name(format!("cajuterm-pty-batch-{id}"))
            .spawn(move || {
                const BATCH_WINDOW: Duration = Duration::from_millis(4);
                const MAX_BATCH_BYTES: usize = 65_536;

                let mut pending = Vec::<u8>::with_capacity(16_384);

                'outer: loop {
                    let first = match rx.recv() {
                        Ok(msg) => msg,
                        Err(_) => break,
                    };

                    let mut reached_eof = false;
                    let mut exit_code: Option<u32> = None;

                    match first {
                        ReadChunk::Bytes(bytes) => pending.extend_from_slice(&bytes),
                        ReadChunk::Eof(code) => {
                            reached_eof = true;
                            exit_code = code;
                        }
                    }

                    let batch_start = Instant::now();
                    while !reached_eof && pending.len() < MAX_BATCH_BYTES {
                        let elapsed = batch_start.elapsed();
                        if elapsed >= BATCH_WINDOW {
                            break;
                        }
                        let remaining = BATCH_WINDOW.saturating_sub(elapsed);
                        match rx.recv_timeout(remaining) {
                            Ok(ReadChunk::Bytes(bytes)) => pending.extend_from_slice(&bytes),
                            Ok(ReadChunk::Eof(code)) => {
                                reached_eof = true;
                                exit_code = code;
                                break;
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => break,
                            Err(mpsc::RecvTimeoutError::Disconnected) => {
                                reached_eof = true;
                                break;
                            }
                        }
                    }

                    let text = extract_valid_utf8(&mut pending, reached_eof);
                    if !text.is_empty() {
                        let _ = app.emit("pty-output", PtyOutputEvent { id, data: text });
                    }

                    if reached_eof {
                        sessions_ref.lock().remove(&id);
                        if !batch_killed.load(Ordering::Relaxed) {
                            let _ = app.emit("pty-exit", PtyExitEvent { id, exit_code });
                        }
                        break 'outer;
                    }
                }
            })
            .map_err(|e| format!("Falha ao criar thread de batching PTY: {e}"))?;

        Ok(id)
    }

    /// Escreve entrada do teclado/clipboard no PTY correspondente.
    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let writer_arc = {
            let guard = self.sessions.lock();
            guard
                .get(&id)
                .map(|s| Arc::clone(&s.writer))
                .ok_or_else(|| format!("Sessão PTY {id} não encontrada"))?
        };

        let mut writer = writer_arc.lock();
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Falha ao escrever no PTY {id}: {e}"))?;
        writer
            .flush()
            .map_err(|e| format!("Falha ao realizar flush no PTY {id}: {e}"))?;
        Ok(())
    }

    /// Atualiza as dimensões (colunas x linhas) do ConPTY.
    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let master_arc = {
            let guard = self.sessions.lock();
            guard
                .get(&id)
                .map(|s| Arc::clone(&s.master))
                .ok_or_else(|| format!("Sessão PTY {id} não encontrada"))?
        };

        let safe_cols = cols.max(2);
        let safe_rows = rows.max(1);

        let master = master_arc.lock();
        master
            .resize(PtySize {
                rows: safe_rows,
                cols: safe_cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Falha ao redimensionar PTY {id}: {e}"))?;
        Ok(())
    }

    /// Encerra explicitamente a sessão PTY e mata o processo filho.
    pub fn kill(&self, id: u32) -> Result<(), String> {
        let session = self.sessions.lock().remove(&id);
        if let Some(session) = session {
            session.killed.store(true, Ordering::Relaxed);
            if let Err(err) = session.child.lock().kill() {
                // Se o processo já tiver encerrado naturalmente, não falhar de forma ruidosa
                let already_exited = session
                    .child
                    .lock()
                    .try_wait()
                    .ok()
                    .flatten()
                    .is_some();
                if !already_exited {
                    return Err(format!("Falha ao finalizar processo do PTY {id}: {err}"));
                }
            }
        }
        Ok(())
    }
}

/// Extrai uma String UTF-8 válida do buffer acumulado, preservando sequências
/// multi-byte incompletas no final do vetor para o próximo lote de 4 ms.
fn extract_valid_utf8(pending: &mut Vec<u8>, flush_all: bool) -> String {
    if pending.is_empty() {
        return String::new();
    }

    if flush_all {
        let out = String::from_utf8_lossy(pending).into_owned();
        pending.clear();
        return out;
    }

    let mut out = String::new();
    let mut cursor = 0usize;

    while cursor < pending.len() {
        match std::str::from_utf8(&pending[cursor..]) {
            Ok(valid) => {
                out.push_str(valid);
                cursor = pending.len();
                break;
            }
            Err(err) => {
                let valid_len = err.valid_up_to();
                if valid_len > 0 {
                    if let Ok(valid_slice) =
                        std::str::from_utf8(&pending[cursor..cursor + valid_len])
                    {
                        out.push_str(valid_slice);
                    }
                    cursor += valid_len;
                }

                match err.error_len() {
                    Some(bad_len) => {
                        out.push('\u{FFFD}');
                        cursor += bad_len;
                    }
                    None => {
                        // Sequência UTF-8 cortada no limite do read(): aguarda próximo lote.
                        break;
                    }
                }
            }
        }
    }

    if cursor > 0 {
        pending.drain(..cursor);
    }

    out
}

fn find_executable_in_path(exe_name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(exe_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn resolve_working_dir(raw_cwd: Option<&str>) -> Option<PathBuf> {
    if let Some(raw) = raw_cwd {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let expanded = if trimmed == "~" {
                dirs::home_dir()
            } else if let Some(rest) = trimmed.strip_prefix("~/").or_else(|| trimmed.strip_prefix("~\\")) {
                dirs::home_dir().map(|home| home.join(rest))
            } else {
                Some(PathBuf::from(trimmed))
            };

            if let Some(path) = expanded {
                if path.is_dir() {
                    return Some(path);
                }
            }
        }
    }
    dirs::home_dir()
}
