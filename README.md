# Token Control

Игровое приложение-компаньон «терминал звездолёта»: очки вычислительной мощности (ОВМ) начисляются за реальный расход токенов Claude Code.

- ТЗ: `Personal Vault/Token Control Docs/ТЗ - MVP - Token Control v0.01.md`
- План разработки: [docs/PLAN.md](docs/PLAN.md)

## Структура

- `packages/shared` — общие TypeScript-типы (API, домен, конфиг)
- `server` — игровой сервер: Fastify + PostgreSQL (Drizzle), авторитетная симуляция
- `client` — Tauri-приложение: веб-UI (Svelte 5 + Vite) + Rust-коннектор Claude Code

## Разработка

Требуются: Node.js 20+, Rust (msvc), Docker (для PostgreSQL).

```sh
npm install
docker compose up -d db     # PostgreSQL на localhost:5544
npm run dev                 # сервер (:8787) + vite-клиент (:5173)
```

Десктоп-оболочка: `npm run tauri dev --workspace client`.

Сервер читает порт из `GAME_SERVER_PORT` (по умолчанию 8787).

### Коннектор Claude Code

Внутри Tauri коннектор стартует автоматически после входа. Отладка без окна:

```sh
cd client/src-tauri
cargo run --bin connector_cli -- <player> [server_url] [projects_dir]
```

Синтетические ОВМ без Claude Code: `npx tsx server/scripts/feed.ts <player> <ovm> <intervalSec>`.
