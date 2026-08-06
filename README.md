# Token Control

Игровое приложение-компаньон: очки вычислительной мощности (ОВМ) начисляются за реальный расход токенов Claude Code на вашей машине и управляют флотилией сущностей в пошаговой стратегии. Сервер авторитетен по игровому состоянию; клиент — ретро-терминал (Tauri + Svelte) со встроенным Rust-коннектором.

## Документация (отдельный приватный репозиторий)

- ТЗ MVP: `Personal Vault/Token Control Docs/ТЗ - MVP - Token Control v0.01.md`
- ТЗ стратегии: `Personal Vault/Token Control Docs/ТЗ - MVP - Token Control v0.02.md`
- План MVP (фазы 0–5): [docs/MVP - Plan.md](docs/MVP%20-%20Plan.md)
- План стратегии (фазы 6–13, ТЗ v0.02): [docs/Strategy - Plan.md](docs/Strategy%20-%20Plan.md)
- Документация реализации (фазы 1–13, как всё устроено): [docs/MVP - Implementation.md](docs/MVP%20-%20Implementation.md)

## Как запустить

Нужны установленные: **Node.js 20+**, **Rust**, **Docker Desktop**.

### Вариант 1 — полное приложение (окно + начисление за Claude Code)

1. Запустите **Docker Desktop** (иконка кита должна быть в трее).
2. В папке проекта выполните:
   ```sh
   npm install        # только при первом запуске
   npm run desktop
   ```
3. Дождитесь окна «TOKEN CONTROL» (первый запуск компилирует Rust — 5–10 минут, дальше секунды), введите любой позывной — вы в игре.

Эта команда сама поднимает PostgreSQL, игровой сервер и открывает окно. Коннектор Claude Code стартует автоматически после входа: работаете с Claude Code — терминал получает ОВМ. Закрытие окна сворачивает игру в трей.

### Вариант 2 — в браузере (без окна, для разработки UI)

1. Запустите **Docker Desktop**.
2. `npm run dev`
3. Откройте http://localhost:5173 и войдите.

В браузере коннектора нет — ОВМ подаются вручную, из второго терминала:

```sh
npx tsx server/scripts/feed.ts user 25 5          # синтетика: 25 ОВМ каждые 5 секунд
# или реальные токены Claude Code без окна:
cd client/src-tauri && cargo run --bin connector_cli -- user
```

(`user` — позывной, под которым вы вошли.)

Варианты можно совмещать: если `npm run dev` уже работает, `npm run desktop`
не станет поднимать второй стек, а просто откроет окно поверх работающего
(проверка портов — [scripts/dev-stack.mjs](scripts/dev-stack.mjs)). Если порт
5173/8787 занят посторонней программой — запуск честно скажет об этом.

### Прочее

- Экраны — цифры `1`–`9` и `0` (Приказы, Флотилия, Сектор, Галактика, Трюм,
  Статус, Журнал, Настройки, База Знаний, Ассистент), либо `Tab`/`Shift+Tab`
  по кругу.
- Ассистент (опционально, ТЗ v0.02 п. 7): чат отвечает на вопросы по Базе
  Знаний и может отдавать приказы флоту естественным языком — списывает ОВМ
  из общего буфера. Движок Ollama (CPU-only, без GPU-ускорения — ~70 МБ)
  зашит в десктоп-сборку как sidecar и поднимается сам при входе в игру;
  если у вас уже есть свой Ollama (например, с GPU-ускорением) на том же
  адресе — используется он, встроенный не трогается. Сама модель (по
  умолчанию `qwen2.5:3b`, ~2 ГБ) не входит в сборку — скачивается по явному
  согласию при первом обращении к ассистенту или кнопкой «Скачать модель» в
  Настройках. Для сборки sidecar-бинарника (разработчикам, не игрокам):
  `node client/scripts/fetch-ollama-sidecar.mjs` перед `tauri dev`/`tauri
  build`. Без движка/модели экран честно сообщает об этом — остальная игра не
  зависит от этой фазы.
- Дебаг-режим: войдите с позывным `DEBUG` — в Настройках появится панель
  отладки (например, `[B] +1000 ОВМ в буфер`). Работает только для этого
  позывного, сервер остальных не пустит.
- Тесты: `npm test` (сервер, нужен Docker) и `cd client/src-tauri && cargo test` (коннектор).
- Сервер читает порт из `GAME_SERVER_PORT` (не `PORT`), БД — из `DATABASE_URL`.
- Игровой баланс (стоимости, формула ОВМ, лимиты, генерация) лежит в таблице `game_config` и перечитывается раз в 60 с — правится без рестарта и без релиза клиента (ТЗ п. 12.2).
- Сброс мира без потери истории начислений: `npx tsx server/scripts/wipe.ts --yes`
  (очищает флот/сектора/знания/Цепь Миров, сохраняет `credit_ledger` и
  `game_config`). Полный сброс вместе с балансом и историей начислений:
  `docker compose down -v` (потом обычный запуск).

## Схема файлов

```
Token Control/
├─ package.json               # корень npm workspaces: dev/build/test всех пакетов
├─ tsconfig.base.json         # общий строгий tsconfig
├─ docker-compose.yml         # PostgreSQL 16 для разработки (порт 5544)
├─ docs/
│  ├─ MVP - Plan.md           # поэтапный план MVP (фазы 0–5, ТЗ v0.01)
│  ├─ MVP - Implementation.md # как реализованы фазы 1–13 (обе части ТЗ)
│  └─ Strategy - Plan.md      # план стратегии (фазы 6–13, ТЗ v0.02) и решения
│
├─ packages/shared/           # @tokencontrol/shared — единый источник типов
│  └─ src/
│     ├─ domain.ts            # ActionType, EntityState, QueueTask, параметры приказов
│     ├─ entities.ts          # каталог классов сущностей и модулей (ENTITY_CLASSES, MODULES)
│     ├─ knowledge.ts         # каталог Базы Знаний/Технологий + системный промпт ассистента
│     ├─ config.ts            # форма GameConfig (стоимости, формула, лимиты) + дефолты
│     ├─ api.ts               # DTO всех эндпоинтов и WS-сообщений (импортируют сервер и клиент)
│     └─ index.ts             # реэкспорт
│
├─ server/                    # игровой сервер: Fastify + Drizzle + PostgreSQL
│  ├─ drizzle.config.ts       # конфиг drizzle-kit (генерация миграций)
│  ├─ vitest.config.ts        # тесты последовательно (общая тестовая БД)
│  ├─ scripts/
│  │  ├─ feed.ts              # фейковый коннектор: качает синтетические ОВМ
│  │  └─ wipe.ts              # сброс мира без потери credit_ledger/game_config
│  ├─ test/                   # vitest: worldgen, API, флот, приказы, знания, Цепь Миров,
│  │                          #   ассистент, нагрузка, переживание рестартов
│  └─ src/
│     ├─ index.ts             # bootstrap: миграции, регенерация, свип, hot-reload конфига, listen
│     ├─ app.ts               # сборка Fastify-приложения (JWT, WS, маршруты) — используется тестами
│     ├─ ws.ts                # реестр WS-подключений по игрокам, push/broadcast
│     ├─ db/
│     │  ├─ schema.ts         # entities/queues (по сущностям), cargo, sectors, objects,
│     │  │                    #   known_objects, visited_sectors, action_log, credit_ledger,
│     │  │                    #   game_config, player_knowledge, player_tech, sector_links,
│     │  │                    #   chain_keys
│     │  ├─ client.ts         # подключение postgres.js + drizzle
│     │  ├─ migrate.ts        # применение миграций (старт сервера и тесты)
│     │  └─ migrations/       # сгенерированный SQL (drizzle-kit generate)
│     ├─ game/                # игровая логика (вся — внутри транзакций)
│     │  ├─ rng.ts            # детерминированный PRNG (xmur3 + mulberry32)
│     │  ├─ worldgen.ts       # генерация содержимого сектора по сиду, галактика 32×32
│     │  ├─ world.ts          # ленивая генерация при первом визите, пометка «посещён»
│     │  ├─ config.ts         # загрузка game_config из БД с дефолтами
│     │  ├─ state.ts          # снапшот StateResponse по флоту (переиспользуют все маршруты)
│     │  ├─ entities.ts       # флот: создание, классы/модули, гейты возможностей
│     │  ├─ actions.ts        # приказы: валидация (enqueue/activate) + исполнение
│     │  ├─ orders.ts         # /orders/available — доступность приказов и кандидаты целей
│     │  ├─ queue.ts          # каскад ОВМ по флоту: слоты, буфер, НЕВЫПОЛНИМО
│     │  ├─ sweep.ts          # тик довершения задач, набравших стоимость, после кулдауна
│     │  ├─ credits.ts        # идемпотентный приём пакетов ОВМ + лимиты анти-абуза
│     │  ├─ knowledge.ts      # прогресс Базы Знаний и Технологий
│     │  ├─ chain.ts          # Цепь Миров: врата, рёбра, ключи, достижимость (BFS)
│     │  ├─ assistant.ts      # контекст и списание ОВМ для ИИ-ассистента
│     │  └─ regen.ts          # восстановление запасов астероидов по таймеру
│     └─ routes/              # тонкие HTTP-обработчики поверх game/
│        ├─ auth.ts           # POST /auth/dev (Steam — фаза 99), создание игрока и домашнего сектора
│        ├─ state.ts          # GET /state
│        ├─ map.ts            # GET /map/sector (только открытое), GET /map/galaxy (+ Цепь Миров)
│        ├─ orders.ts         # orders/available|add|remove|reorder, fleet/priority|rename
│        ├─ knowledge.ts      # /knowledge, /tech, /tech/research
│        ├─ chain.ts          # /chain, /chain/connect
│        ├─ assistant.ts      # POST /assistant/prepare
│        ├─ credits.ts        # POST /credits/submit (от коннектора)
│        ├─ log.ts            # GET /log — журнал с курсором
│        └─ debug.ts          # только dev:DEBUG — кредит/спавн/ключи Цепи Миров
│
└─ client/                    # Tauri-приложение
   ├─ vite.config.ts          # dev-прокси /api и /ws → сервер :8787
   ├─ index.html              # точка входа веб-части
   ├─ scripts/fetch-ollama-sidecar.mjs # готовит CPU-only Ollama sidecar (~70 МБ) для сборки
   ├─ src/                    # веб-UI: Svelte 5 (runes)
   │  ├─ main.ts, app.css     # монтирование и терминальная тема (палитра, панели)
   │  ├─ App.svelte           # оболочка: шапка-телеметрия, меню, экраны, строка сообщений
   │  ├─ Login.svelte         # dev-вход по позывному
   │  ├─ lib/
   │  │  ├─ screens.ts        # единый реестр экранов (меню + хоткеи + компонент)
   │  │  ├─ api.ts            # типизированный HTTP-клиент + WS с реконнектом
   │  │  ├─ game.svelte.ts    # реактивное состояние флота, постановка приказов, polling
   │  │  ├─ assistant.svelte.ts # ассистент: транспорт до Ollama, tool-схема, резолв команд
   │  │  ├─ connector.svelte.ts # мост к Rust-коннектору (Tauri invoke/events, фолбэк в браузере)
   │  │  ├─ i18n.svelte.ts    # локализация RU/EN (русские строки — ключи словаря)
   │  │  └─ terminal/         # общие компоненты: Overlay, Confirm, ListPicker, Tree, keys, format
   │  └─ screens/             # 10 экранов (ТЗ v0.02 пп. 2–7), хоткеи 1–9 и 0
   │     ├─ Orders.svelte     # приказы по флоту: дерево «сущность → слоты → доступно/недоступно»
   │     ├─ Fleet.svelte      # список сущностей, приоритет ОВМ, переименование
   │     ├─ SectorMap.svelte  # ASCII-карта сектора, курсор, выбор цели/точки
   │     ├─ GalaxyMap.svelte  # сетка галактики, Цепь Миров, ключи, выбор цели гиперпрыжка
   │     ├─ Cargo.svelte      # трюм и вместимость сущности
   │     ├─ Status.svelte     # накопитель ОВМ, статус коннектора
   │     ├─ Journal.svelte    # журнал операций
   │     ├─ Settings.svelte   # CRT, язык, коннектор, ассистент, аккаунт, отладка
   │     ├─ Knowledge.svelte  # База Знаний и Технологии
   │     └─ Assistant.svelte  # чат с ИИ-ассистентом, подтверждение команд флоту
   └─ src-tauri/              # Rust-часть
      ├─ tauri.conf.json      # окно, сборка, externalBin/resources для Ollama sidecar
      ├─ capabilities/default.json # разрешения: core, http (localhost — для ассистента)
      ├─ Cargo.toml           # tauri, tauri-plugin-http/shell/log, rusqlite, reqwest
      ├─ binaries/            # (не в git) готовится fetch-ollama-sidecar.mjs
      └─ src/
         ├─ main.rs           # точка входа десктоп-приложения
         ├─ lib.rs            # Tauri: плагины, команды connector_start/stop/ollama_ensure_running, трей
         ├─ ollama.rs         # авто-поднятие встроенного/чужого Ollama, проверка модели
         ├─ bin/connector_cli.rs # коннектор без окна — для отладки
         └─ connector/        # коннектор Claude Code (ТЗ п. 7)
            ├─ mod.rs         # цикл: рескан 10с → дедуп → ОВМ → outbox → отправка 30с; baseline
            ├─ parser.rs      # чтение JSONL с офсетов; только числовые поля, текст не читается
            ├─ store.rs       # SQLite: офсеты, дедуп-индекс, оффлайн-outbox, дробный остаток
            └─ submit.rs      # HTTP: /config (коэффициенты) и /credits/submit
```

## Что дальше

Фазы 0–13 завершены (MVP + стратегия ТЗ v0.02, включая опциональный
Ассистент) — см. [docs/MVP - Implementation.md](docs/MVP%20-%20Implementation.md).
Дальше по `docs/Strategy - Plan.md`:

- Фазы 14–98 — зарезервированы под roadmap ТЗ v0.02 (производство
  звездолётов и дронов, постройки в секторе, торговля между игроками, разные
  версии терминалов на старте). Не начаты, содержание не детализировано.
- Фаза 99 — Steam: авторизация auth ticket вместо dev-заглушки, реальный
  биллинг ключей Цепи Миров через Steam Inventory поверх уже готовой
  механики `chain_keys`, сборки/депо, страница, privacy policy. Не начата.
