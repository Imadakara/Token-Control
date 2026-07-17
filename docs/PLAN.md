# Token Control — план разработки MVP

По ТЗ: `Personal Vault/Token Control Docs/ТЗ - MVP - Token Control v0.01.md` (v0.01).

## Принятые решения

- **Клиент**: Tauri (Rust-бэкенд + веб-UI на Svelte 5 + Vite + TypeScript). Коннектор Claude Code живёт в Rust-части Tauri.
- **Сервер**: Node.js + TypeScript, Fastify (+ `@fastify/websocket`), PostgreSQL 16, Drizzle ORM, zod-валидация.
- **Steam**: на старте — dev-заглушка авторизации (локальный player ID → сессионный токен); Steamworks auth ticket — отдельной финальной фазой.
- **Монорепо**: npm workspaces; общие типы API в `packages/shared` (импортируются сервером и веб-частью клиента). Rust-сторона дублирует 2 маленьких DTO (credits.submit, config) как serde-структуры — без кодогенерации.

## Структура репозитория

```
Token Control/
├─ package.json                  # npm workspaces
├─ tsconfig.base.json
├─ packages/shared/              # DTO API, WS-сообщения, доменные enum'ы, форма GameConfig
├─ server/                       # Fastify + Drizzle + PostgreSQL
│  └─ src/{routes,game,db,ws.ts}
├─ client/
│  ├─ src-tauri/                 # Rust: коннектор (watcher, parser, dedup, buffer, submit)
│  └─ src/                       # Svelte: screens/, lib/api.ts, lib/terminal/ (CRT, псевдографика)
└─ docs/
```

## Фазы

### Фаза 0 — Скелет (~0.5 дня)
Workspaces, tsconfig, shared-пакет, Fastify hello-world, Tauri hello-world, Vite-прокси на сервер, docker-compose с PostgreSQL, drizzle-kit.
**Критерий**: `npm run dev` поднимает сервер и клиент, клиент показывает «CONNECTED».

### Фаза 1 — Сервер: мир и состояние (2–3 дня)
Схема БД (все таблицы ниже), миграции; dev-auth (`POST /auth/dev`); детерминированная ленивая генерация мира (сид в конфиге; сектор генерируется при первом визите: станция ≤1, астероиды, контейнеры, феномены); `GET /state`, `GET /map/sector`, `GET /map/galaxy`, `GET /config` (стоимости, коэффициенты формулы, лимиты — из таблицы `game_config`).
**Критерий**: интеграционные тесты vitest; повторный визит в сектор возвращает те же объекты.

### Фаза 2 — Движок очереди и действия (3–4 дня)
Сердце игры. `queue.add/remove/reorder`; валидация при постановке и при активации («НЕВЫПОЛНИМО» → пропуск + журнал); 7 действий со стоимостями 10/100/250/1000 из конфига; буфер ОВМ (кап 100000, переполнение игнорируется, буфер вливается в новую задачу, излишек переносится дальше); идемпотентный `POST /credits/submit`; `credit_ledger` + анти-абуз (потолок в минуту/час, суточный кап, мягкое урезание); регенерация ресурсов по таймеру; WS-пуш прогресса.
**Критерий**: fake-credits CLI (`server/scripts/feed.ts`) качает синтетические ОВМ; тесты на сдвиг очереди, пропуск, буфер, идемпотентность, урезание. Игра целиком играется через curl.

### Фаза 3 — Терминальный UI (4–6 дней)
7 экранов (очередь, карта сектора, карта галактики, трюм, статус корабля, журнал, настройки) + главное меню; шапка-телеметрия (входящий поток ОВМ, прогресс активной задачи, номер слота); клавиатура (стрелки/Enter/Esc, хоткеи) + мышь; карты — ASCII/псевдографика с выбором цели; подтверждение удаления задачи; CRT-эффект одним отключаемым CSS-слоем (без canvas и терминальных эмуляторов — DOM-таблицы и CSS).
**Критерий**: полный ручной цикл: сканирование → прыжок → анализ → добыча → трюм заполняется → журнал пишется. **Играбельный локальный луп.**

### Фаза 4 — Коннектор Claude Code (3–4 дня)
Rust в `src-tauri`: watcher `notify` на `~/.claude/projects` (+ настраиваемый путь) с фолбэк-ресканом раз в 10–15 с; инкрементальное чтение по сохранённым байтовым офсетам; устойчивость к недописанной последней строке и «чужим» форматам записей (парсим только `type=="assistant"` с `message.usage`); читаются только `uuid`/`requestId`/`timestamp`/`model` и 4 поля usage — текст не читается; глобальная дедупликация (ключ `requestId`, иначе `uuid`) в rusqlite с UNIQUE-индексом; при первом запуске история не зачисляется (baseline-проход); конвертация T = in + out + 1·cache_w + 0.1·cache_r, ОВМ = T/1000 (дробный остаток — на клиенте), коэффициенты с `/config`; оффлайн-буфер в rusqlite; батчи `credits.submit` раз в 30–60 с с ретраями; статус коннектора в UI через Tauri-события.
**Критерий**: реальная сессия Claude Code даёт поток ОВМ в игру; обрыв сети посреди сессии не задваивает начисления.

### Фаза 5 — Надёжность и полировка (2–3 дня)
Переживание рестартов обеих сторон (офсеты/буфер клиента, транзакционный прогресс сервера); трей/тихий режим, CPU≈0 в покое (пауза CRT-анимации без фокуса); EN+RU; hot-reload конфига; ошибки в терминальном стиле.
**Критерий**: kill/restart клиента и сервера посреди задачи — ничего не потеряно и не задвоено.

### Фаза 6 — Steam
Steamworks auth ticket вместо заглушки (колонка `steam_id` есть с Фазы 1), сборки/депо, страница, privacy policy (GDPR). Намеренно последняя — от неё ничего не зависит.

## Модель данных

- `players` (id PK, steam_id nullable/unique, created_at, params jsonb, ovm_buffer)
- `ships` (player_id PK, sector_id, x, y, docked_object_id nullable)
- `queues` (player_id, slot 1–3, action_type, params jsonb, cost, progress, status)
- `cargo` (player_id, item_type, qty / object_id)
- `sectors` (id = "gx:gy", seed, generated_at) / `objects` (id, sector_id, type, x, y, props jsonb, resource_amount, max_resource, respawn_at)
- `known_objects` (player_id, object_id, level: scanned|analyzed)
- `action_log` (id, player_id, ts, action_type, result, details jsonb)
- `credit_ledger` (player_id, packet_seq, ovm, tokens jsonb, interval, received_at; **UNIQUE(player_id, packet_seq)** — основа идемпотентности)
- `game_config` (key, value jsonb)

## API

- `POST /auth/dev` (позже `POST /auth/steam`) → сессионный токен (`@fastify/jwt`)
- `GET /state`, `GET /config`, `GET /cargo`, `GET /log?cursor=`
- `POST /queue/add|remove|reorder`
- `POST /credits/submit` `{packetSeq, ovm, tokens, intervalStart, intervalEnd}` → `{accepted, clipped}`
- `GET /map/sector`, `GET /map/galaxy`
- WS `/ws`: `progress`, `state_delta`, `config_changed`

## Ключевые риски и ответы

1. **Дедупликация JSONL** (resume/fork дублируют записи): ключ `requestId`/`uuid` в rusqlite, O(1); история до установки не зачисляется.
2. **Недописанная строка / чужие записи**: офсет двигается только за полные строки; строгий фильтр по `type=="assistant"` + наличию `usage`; фикстурные `cargo test`.
3. **Оффлайн-синк и идемпотентность**: монотонный `packetSeq` в rusqlite, локальный outbox чистится только после ack; сервер — `ON CONFLICT DO NOTHING` + начисление в той же транзакции.
4. **Windows и watcher**: watcher — оптимизация, не источник истины (рескан-таймер по размеру файлов); пути через `PathBuf`/`dirs`.
5. **Авторитетность и краш-безопасность**: весь игровой прогресс применяется только в транзакции `credits.submit` (леджер → лимиты → буфер/задача → каскад завершения); in-memory-состояния на сервере нет — рестарты бесплатны.
6. **Анти-абуз против честных всплесков**: лимиты в конфиге, излишек урезается (не реджект); в леджере хранятся и заявленное, и принятое + агрегаты по `model` — данные для калибровки N копятся с первого дня.

## Порядок работ для соло-разработки

Фазы 0–3 (играбельная игра на фейковых ОВМ доказывает фан) → Фаза 4 (уникальная механика) → 5 → 6.
