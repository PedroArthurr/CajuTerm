/**
 * Wrapper inteligente para o CLI do Tauri:
 * 1. Localiza `cargo` no PATH ou em `%USERPROFILE%\.cargo\bin` (caso recém-instalado).
 * 2. Verifica se o Rust e as ferramentas C++ (MSVC) estão presentes no Windows.
 * 3. Executa `tauri <args>` com o PATH ajustado ou exibe instruções claras de instalação.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function findCargoDir() {
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const exe = process.platform === 'win32' ? 'cargo.exe' : 'cargo';

  const envDirs = (process.env.PATH || '').split(pathSep).filter(Boolean);
  for (const dir of envDirs) {
    if (fs.existsSync(path.join(dir, exe))) {
      return dir;
    }
  }

  const candidates = [
    process.env.CARGO_HOME ? path.join(process.env.CARGO_HOME, 'bin') : '',
    path.join(os.homedir(), '.cargo', 'bin'),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, exe))) {
      return dir;
    }
  }
  return null;
}

function hasMsvcBuildTools() {
  if (process.platform !== 'win32') return true;
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (!fs.existsSync(vswhere)) return false;

  const res = spawnSync(
    vswhere,
    ['-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
    { encoding: 'utf8' }
  );
  return Boolean(res.stdout && res.stdout.trim().length > 0);
}

function unlockRunningBinaries() {
  if (process.platform !== 'win32') return;

  for (const profile of ['release', 'debug']) {
    const dir = path.resolve('src-tauri', 'target', profile);
    if (!fs.existsSync(dir)) continue;

    // Limpa cópias antigas que já não estão mais em execução
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (/^cajuterm\.old.*\.exe$/i.test(entry)) {
          try {
            fs.unlinkSync(path.join(dir, entry));
          } catch {
            // Ainda em uso por outra instância; ignora
          }
        }
      }
    } catch {
      // Ignora erro de listagem
    }

    const exePath = path.join(dir, 'cajuterm.exe');
    if (!fs.existsSync(exePath)) continue;

    try {
      const fd = fs.openSync(exePath, 'r+');
      fs.closeSync(fd);
    } catch (err) {
      const code = err && typeof err === 'object' ? err.code : '';
      if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') {
        const backupPath = path.join(dir, `cajuterm.old-${Date.now()}.exe`);
        try {
          fs.renameSync(exePath, backupPath);
          console.log(`[CajuTerm] Binário em uso movido para ${path.basename(backupPath)} para permitir o build.`);
        } catch (renameErr) {
          console.warn(`[CajuTerm] Não foi possível liberar ${exePath} (feche o app aberto): ${renameErr.message}`);
        }
      }
    }
  }
}

const cargoDir = findCargoDir();

if (!cargoDir) {
  console.error('\n[CajuTerm] Rust (cargo/rustc) não foi encontrado nesta máquina.\n');
  console.error('O comando "tauri dev/build" precisa compilar o backend Rust (ConPTY + Tauri 2).');
  console.error('Instale os pré-requisitos no PowerShell e tente novamente:\n');
  console.error('  1) Instalar Rust:');
  console.error('     winget install Rustlang.Rustup\n');
  console.error('  2) Instalar Visual Studio Build Tools (carga "Desenvolvimento para desktop com C++"):');
  console.error('     winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"\n');
  console.error('  3) Feche e reabra o PowerShell, valide `cargo --version` e execute:');
  console.error('     npm run tauri dev\n');
  console.error('Dica: para visualizar apenas a interface Web/Shaders agora sem Rust, use: npm run dev\n');
  process.exit(1);
}

const sep = process.platform === 'win32' ? ';' : ':';
process.env.PATH = `${cargoDir}${sep}${process.env.PATH || ''}`;

if (!hasMsvcBuildTools()) {
  console.warn('\n[CajuTerm] Aviso: Visual Studio C++ Build Tools (MSVC) não detectado.');
  console.warn('Se a compilação Rust falhar no linker (`link.exe`), instale:');
  console.warn('  winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"\n');
}

const tauriBin = path.resolve(
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tauri.cmd' : 'tauri'
);

const args = process.argv.slice(2);
if (args[0] === 'build' || args[0] === 'dev') {
  unlockRunningBinaries();
}

const result = spawnSync(tauriBin, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

process.exit(result.status ?? 1);
