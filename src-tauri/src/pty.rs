use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;

/// Mensagem única do canal por sessão (`tauri::ipc::Channel`) enviada ao frontend.
/// Serializa como `{ kind: "data", data }` ou `{ kind: "exit", exitCode }`.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PtyEvent {
    Data {
        data: String,
    },
    #[serde(rename_all = "camelCase")]
    Exit {
        exit_code: Option<u32>,
    },
}

struct PtySession {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    /// Fila de entrada consumida pela thread de escrita dedicada (preserva a ordem dos bytes).
    input: mpsc::Sender<Vec<u8>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    killed: Arc<AtomicBool>,
    /// PID do shell raiz; usado para detectar programas em primeiro plano (claude, vim, ssh...).
    pid: Option<u32>,
}

impl PtySession {
    /// Mata o shell; o drop do master (fim desta função) chama ClosePseudoConsole,
    /// que encerra também os processos de console ainda anexados à sessão.
    fn terminate(mut self) {
        self.killed.store(true, Ordering::SeqCst);
        // portable-pty 0.8.1 (Windows) retorna Err mesmo em sucesso; o resultado não é confiável.
        let _ = self.killer.kill();
    }
}

/// Gerenciador thread-safe das sessões PTY ativas (id -> sessão ConPTY).
pub struct PtyManager {
    next_id: AtomicU32,
    sessions: Arc<Mutex<HashMap<u32, PtySession>>>,
}

enum ReadMsg {
    Bytes(Vec<u8>),
    /// Enviado pela thread waiter quando o processo do shell termina.
    Exit(Option<u32>),
}

const READ_BUF_BYTES: usize = 65_536;
/// Fila limitada: com o frontend lento, o leitor bloqueia e o ConPTY aplica backpressure no filho.
const READ_QUEUE_DEPTH: usize = 64;
const BATCH_WINDOW: Duration = Duration::from_millis(4);
const MAX_BATCH_BYTES: usize = 131_072;
/// Tempo máximo para drenar a saída restante depois que o shell terminou.
const EXIT_DRAIN_GRACE: Duration = Duration::from_millis(1500);

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

    /// Spawna uma nova sessão PTY com ConPTY. Threads por sessão:
    /// - leitor: read() bloqueante (64 KB) -> fila limitada;
    /// - batcher: agrega ~4 ms, decodifica UTF-8 preservando sequências cortadas, envia no `Channel`;
    /// - escritor: consome a fila de entrada (pty_write só enfileira);
    /// - waiter: `wait()` no filho -> remove a sessão (ClosePseudoConsole) -> código de saída real.
    ///
    /// O evento `exit` é enviado exatamente uma vez, pelo batcher, depois de toda a saída drenada.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        &self,
        shell: Option<String>,
        args: Option<Vec<String>>,
        cwd: Option<String>,
        env: Option<HashMap<String, String>>,
        cols: u16,
        rows: u16,
        on_event: Channel<PtyEvent>,
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
        cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        cmd.env("WT_SESSION", "cajuterm-conpty");

        if let Some(custom_env) = env {
            for (key, value) in custom_env {
                if !key.trim().is_empty() {
                    cmd.env(key, value);
                }
            }
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Falha ao iniciar shell '{resolved_shell}': {e}"))?;

        // Libera a referência do slave no processo pai.
        drop(pair.slave);

        let reader = match pair.master.try_clone_reader() {
            Ok(r) => r,
            Err(e) => {
                let _ = child.kill();
                return Err(format!("Falha ao clonar leitor PTY: {e}"));
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(w) => w,
            Err(e) => {
                let _ = child.kill();
                return Err(format!("Falha ao obter escritor PTY: {e}"));
            }
        };

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let killed_flag = Arc::new(AtomicBool::new(false));
        let killer = child.clone_killer();
        let shell_pid = child.process_id();
        let (tx, rx) = mpsc::sync_channel::<ReadMsg>(READ_QUEUE_DEPTH);
        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>();

        // Thread 1: leitura bloqueante dedicada do stream ConPTY
        let reader_tx = tx.clone();
        if let Err(e) = std::thread::Builder::new()
            .name(format!("cajuterm-pty-read-{id}"))
            .spawn(move || read_loop(reader, reader_tx))
        {
            let _ = child.kill();
            return Err(format!("Falha ao criar thread de leitura PTY: {e}"));
        }

        // Thread 2: escrita ordenada (write_all bloqueante fora da thread principal)
        if let Err(e) = std::thread::Builder::new()
            .name(format!("cajuterm-pty-write-{id}"))
            .spawn(move || write_loop(writer, input_rx))
        {
            let _ = child.kill();
            return Err(format!("Falha ao criar thread de escrita PTY: {e}"));
        }

        // Thread 3: agregação (batching) + decodificação UTF-8 + entrega no Channel
        let batch_killed = Arc::clone(&killed_flag);
        if let Err(e) = std::thread::Builder::new()
            .name(format!("cajuterm-pty-batch-{id}"))
            .spawn(move || batch_loop(rx, on_event, batch_killed))
        {
            let _ = child.kill();
            return Err(format!("Falha ao criar thread de batching PTY: {e}"));
        }

        // A sessão entra no mapa antes do waiter existir, para que o waiter sempre a encontre.
        self.sessions.lock().insert(
            id,
            PtySession {
                master: Arc::new(Mutex::new(pair.master)),
                input: input_tx,
                killer,
                killed: killed_flag,
                pid: shell_pid,
            },
        );

        // Thread 4: waiter — detecta a saída do shell mesmo que o ConPTY não feche o pipe de saída.
        let sessions_ref = Arc::clone(&self.sessions);
        let spawn_waiter = std::thread::Builder::new()
            .name(format!("cajuterm-pty-wait-{id}"))
            .spawn(move || {
                let exit_code = child.wait().ok().map(|status| status.exit_code());
                // Remove e dropa a sessão fora do lock: drop do master -> ClosePseudoConsole -> EOF no leitor.
                let session = sessions_ref.lock().remove(&id);
                drop(session);
                let _ = tx.send(ReadMsg::Exit(exit_code));
            });

        if let Err(e) = spawn_waiter {
            // O closure (com `child` e `tx`) já foi descartado; encerra via killer da sessão.
            let session = self.sessions.lock().remove(&id);
            if let Some(session) = session {
                session.terminate();
            }
            return Err(format!("Falha ao criar thread de espera PTY: {e}"));
        }

        Ok(id)
    }

    /// Enfileira entrada do teclado/clipboard para a thread de escrita da sessão (não bloqueia).
    pub fn write(&self, id: u32, data: String) -> Result<(), String> {
        let guard = self.sessions.lock();
        let session = guard
            .get(&id)
            .ok_or_else(|| format!("Sessão PTY {id} não encontrada"))?;
        session
            .input
            .send(data.into_bytes())
            .map_err(|_| format!("Falha ao escrever no PTY {id}: entrada encerrada"))
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

    /// `true` se o shell da sessão tem algum processo filho vivo (programa em primeiro plano).
    /// Texto injetado no PTY nesse estado vira entrada do programa, não comando do shell.
    pub fn has_child_process(&self, id: u32) -> Result<bool, String> {
        let pid = {
            let guard = self.sessions.lock();
            guard
                .get(&id)
                .ok_or_else(|| format!("Sessão PTY {id} não encontrada"))?
                .pid
        };
        Ok(pid.map(shell_has_child).unwrap_or(false))
    }

    /// Encerra explicitamente a sessão PTY e mata o processo filho (sem evento `exit`).
    pub fn kill(&self, id: u32) -> Result<(), String> {
        let session = self.sessions.lock().remove(&id);
        if let Some(session) = session {
            session.terminate();
        }
        Ok(())
    }

    /// Encerra todas as sessões (saída do app).
    pub fn kill_all(&self) {
        let sessions: Vec<PtySession> = self.sessions.lock().drain().map(|(_, s)| s).collect();
        for session in sessions {
            session.terminate();
        }
    }
}

fn read_loop(mut reader: Box<dyn Read + Send>, tx: mpsc::SyncSender<ReadMsg>) {
    let mut buf = vec![0u8; READ_BUF_BYTES];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if tx.send(ReadMsg::Bytes(buf[..n].to_vec())).is_err() {
                    break;
                }
            }
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
}

fn write_loop(mut writer: Box<dyn Write + Send>, rx: mpsc::Receiver<Vec<u8>>) {
    while let Ok(bytes) = rx.recv() {
        if writer.write_all(&bytes).and_then(|_| writer.flush()).is_err() {
            break;
        }
    }
}

fn batch_loop(rx: mpsc::Receiver<ReadMsg>, channel: Channel<PtyEvent>, killed: Arc<AtomicBool>) {
    let mut pending = Vec::<u8>::with_capacity(READ_BUF_BYTES);
    let mut exit_code: Option<u32> = None;
    let mut exit_deadline: Option<Instant> = None;

    loop {
        // Termina quando leitor + waiter fecharam a fila, ou quando o prazo de drenagem pós-exit expira.
        let mut finished = false;

        let first = match exit_deadline {
            None => rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
            Some(deadline) => rx.recv_timeout(deadline.saturating_duration_since(Instant::now())),
        };

        match first {
            Ok(ReadMsg::Bytes(bytes)) => pending.extend_from_slice(&bytes),
            Ok(ReadMsg::Exit(code)) => {
                exit_code = code;
                exit_deadline = Some(Instant::now() + EXIT_DRAIN_GRACE);
                continue;
            }
            Err(_) => finished = true,
        }

        if !finished {
            let batch_start = Instant::now();
            while pending.len() < MAX_BATCH_BYTES {
                let remaining = BATCH_WINDOW.saturating_sub(batch_start.elapsed());
                if remaining.is_zero() {
                    break;
                }
                match rx.recv_timeout(remaining) {
                    Ok(ReadMsg::Bytes(bytes)) => pending.extend_from_slice(&bytes),
                    Ok(ReadMsg::Exit(code)) => {
                        exit_code = code;
                        exit_deadline = Some(Instant::now() + EXIT_DRAIN_GRACE);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        finished = true;
                        break;
                    }
                }
            }
        }

        let text = extract_valid_utf8(&mut pending, finished);
        if !text.is_empty() && !killed.load(Ordering::SeqCst) {
            let _ = channel.send(PtyEvent::Data { data: text });
        }

        if finished {
            break;
        }
    }

    if !killed.load(Ordering::SeqCst) {
        let _ = channel.send(PtyEvent::Exit { exit_code });
    }
}

/// Extrai uma String UTF-8 válida do buffer acumulado, preservando sequências
/// multi-byte incompletas no final do vetor para o próximo lote.
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

/// Varre a tabela de processos procurando filhos diretos de `shell_pid`.
/// conhost/OpenConsole são hospedeiros de console, não programas do usuário.
#[cfg(windows)]
fn shell_has_child(shell_pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    const IGNORED: [&str; 2] = ["conhost.exe", "openconsole.exe"];

    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        let mut found = false;
        let mut ok = Process32FirstW(snap, &mut entry) != 0;
        while ok {
            if entry.th32ParentProcessID == shell_pid && entry.th32ProcessID != shell_pid {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_ascii_lowercase();
                if !IGNORED.contains(&name.as_str()) {
                    found = true;
                    break;
                }
            }
            ok = Process32NextW(snap, &mut entry) != 0;
        }
        CloseHandle(snap);
        found
    }
}

#[cfg(not(windows))]
fn shell_has_child(_shell_pid: u32) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::extract_valid_utf8;

    #[test]
    fn carries_split_multibyte_sequence() {
        let bytes = "aé€😀".as_bytes();
        for split in 0..=bytes.len() {
            let mut pending = bytes[..split].to_vec();
            let mut out = extract_valid_utf8(&mut pending, false);
            pending.extend_from_slice(&bytes[split..]);
            out.push_str(&extract_valid_utf8(&mut pending, false));
            assert_eq!(out, "aé€😀", "split at {split}");
            assert!(pending.is_empty());
        }
    }
}
