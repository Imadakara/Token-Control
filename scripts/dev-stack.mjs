/**
 * beforeDevCommand для `npm run desktop`: делает запуск устойчивым к уже
 * занятым портам.
 *  - dev-стек уже работает (наш vite на 5173) → переиспользуем, ничего не
 *    запускаем (Tauri сам подключится к devUrl);
 *  - 5173 занят посторонним → понятная ошибка вместо стектрейса vite;
 *  - работает только игровой сервер (8787) → доподнимаем один vite;
 *  - всё свободно → полный стек (docker db + сервер + vite).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return await res.text();
  } catch {
    return null;
  }
}

function run(npmArgs) {
  const child = spawn('npm', npmArgs, { cwd: ROOT, stdio: 'inherit', shell: true });
  child.on('exit', (code) => process.exit(code ?? 1));
}

const vitePage = await probe('http://localhost:5173/');
if (vitePage !== null) {
  if (vitePage.includes('TOKEN CONTROL')) {
    console.log('[desktop] dev-стек уже запущен — переиспользую его (порт 5173)');
    process.exit(0);
  }
  console.error(
    '[desktop] ОШИБКА: порт 5173 занят посторонним процессом.\n' +
      '[desktop] Закройте его (или другой запуск Token Control) и повторите npm run desktop.',
  );
  process.exit(1);
}

const health = await probe('http://127.0.0.1:8787/health');
if (health !== null) {
  if (health.includes('tokencontrol-server')) {
    console.log('[desktop] игровой сервер уже работает (8787) — запускаю только vite');
    run(['run', 'dev:client']);
  } else {
    console.error(
      '[desktop] ОШИБКА: порт 8787 занят посторонним процессом.\n' +
        '[desktop] Освободите его или задайте GAME_SERVER_PORT и повторите запуск.',
    );
    process.exit(1);
  }
} else {
  run(['run', 'dev']); // predev поднимет PostgreSQL, дальше сервер + vite
}
