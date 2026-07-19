/**
 * Готовит sidecar-бинарник встроенного Ollama (Strategy - Plan.md: «Ollama в
 * комплекте с клиентом»). Скачивает официальный portable zip Windows-сборки
 * (~1.5 ГБ — она уже без ROCm/MLX, они отдельными архивами), вырезает
 * CUDA/Vulkan-бэкенды (не нужны CPU-only sidecar'у — GPU-ускорение остаётся
 * только у уже установленного игроком Ollama, если он есть, см.
 * src-tauri/src/ollama.rs) и кладёт CPU-ядро (~70 МБ) в
 * client/src-tauri/binaries/ под именем, которое ждёт Tauri sidecar
 * (target triple в имени файла).
 *
 * Только Windows на первую итерацию (см. план). Результат НЕ коммитится в
 * git (см. .gitignore) — запускать перед `tauri build`/`tauri dev`, если
 * бинарника ещё нет.
 *
 * Использование: node scripts/fetch-ollama-sidecar.mjs [версия Ollama]
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const CLIENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BINARIES_DIR = path.join(CLIENT_ROOT, 'src-tauri', 'binaries');
const TARGET_NAME = 'ollama-x86_64-pc-windows-msvc.exe';
// Бэкенды ускорения — единственная причина, по которой полный дистрибутив
// весит гигабайты; sidecar работает на CPU, они не нужны.
const GPU_BACKEND_DIRS = ['cuda_v12', 'cuda_v13', 'rocm_v7_1', 'rocm', 'vulkan', 'mlx'];

const version = process.argv[2] ?? 'v0.32.1';
const url = `https://github.com/ollama/ollama/releases/download/${version}/ollama-windows-amd64.zip`;

if (process.platform !== 'win32') {
  console.error('[ollama-sidecar] Только Windows на первую итерацию — см. план.');
  process.exit(1);
}

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ollama-sidecar-'));
const zipPath = path.join(tmpDir, 'ollama.zip');
const extractDir = path.join(tmpDir, 'extracted');

try {
  console.log(`[ollama-sidecar] Скачиваю ${url} (~1.5 ГБ, разово, для сборки sidecar)...`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} при скачивании ${url}`);
  await pipeline(res.body, createWriteStream(zipPath));

  console.log('[ollama-sidecar] Распаковываю...');
  await fs.mkdir(extractDir, { recursive: true });
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`],
    { stdio: 'inherit' },
  );

  const exeSrc = path.join(extractDir, 'ollama.exe');
  const libSrc = path.join(extractDir, 'lib', 'ollama');
  if (!existsSync(exeSrc)) {
    throw new Error(`ollama.exe не найден в распакованном архиве (${extractDir}) — формат дистрибутива изменился?`);
  }

  console.log('[ollama-sidecar] Вырезаю GPU-бэкенды...');
  for (const dir of GPU_BACKEND_DIRS) {
    const p = path.join(libSrc, dir);
    if (existsSync(p)) {
      await fs.rm(p, { recursive: true, force: true });
      console.log(`  - удалено lib/ollama/${dir}`);
    }
  }

  await fs.mkdir(BINARIES_DIR, { recursive: true });
  await fs.copyFile(exeSrc, path.join(BINARIES_DIR, TARGET_NAME));
  const libDest = path.join(BINARIES_DIR, 'lib', 'ollama');
  await fs.rm(libDest, { recursive: true, force: true });
  await fs.cp(libSrc, libDest, { recursive: true });

  const du = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-ChildItem "${BINARIES_DIR}" -Recurse -File | Measure-Object Length -Sum).Sum`],
    { encoding: 'utf8' },
  ).trim();
  console.log(`[ollama-sidecar] Готово: ${BINARIES_DIR} (${(Number(du) / 1024 / 1024).toFixed(1)} МБ)`);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
