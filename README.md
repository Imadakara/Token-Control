# Token Control

Игровое приложение-компаньон «терминал звездолёта»: очки вычислительной мощности (ОВМ) начисляются за реальный расход токенов Claude Code на вашей машине. Сервер авторитетен по игровому состоянию; клиент — ретро-терминал (Tauri + Svelte) со встроенным Rust-коннектором.

- ТЗ: `Personal Vault/Token Control Docs/ТЗ - MVP - Token Control v0.01.md`
- План разработки и статус фаз: [docs/PLAN.md](docs/PLAN.md)

## Быстрый запуск

Требуются: **Node.js 20+**, **Rust (msvc)**, **Docker** (PostgreSQL). Один раз:

```sh
npm install                # зависимости всех воркспейсов
docker compose up -d db    # PostgreSQL на localhost:5544 (данные в volume)
```

Каждый день:

```sh
npm run dev                # сервер :8787 + веб-клиент :5173 (миграции применяются сами)
```

Откройте http://localhost:5173, введите позывной — корабль появится в секторе 5:5.

Варианты подачи ОВМ:

| Способ | Команда | Когда |
|---|---|---|
| Синтетика | `npx tsx server/scripts/feed.ts misha 25 5` | Быстрая проверка геймплея |
| Реальный Claude Code | `cd client/src-tauri && cargo run --bin connector_cli -- misha` | Коннектор без окна: читает `~/.claude/projects`, историю не зачисляет |
| Десктоп-оболочка | `npm run tauri dev --workspace client` | Полное приложение: окно + трей + автозапуск коннектора после входа |

Тесты: `npm test` (сервер, нужен Docker) и `cd client/src-tauri && cargo test` (коннектор).

Полезное:

- Сервер читает порт из `GAME_SERVER_PORT` (не `PORT` — его подставляют превью-раннеры), БД — из `DATABASE_URL`.
- Игровой баланс (стоимости, формула ОВМ, лимиты, генерация) лежит в таблице `game_config` и перечитывается раз в 60 с — правится без рестарта и без релиза клиента (ТЗ п. 12.2).
- Сброс мира: `docker compose down -v && docker compose up -d db`.

## Схема файлов

```
Token Control/
├─ package.json               # корень npm workspaces: dev/build/test всех пакетов
├─ tsconfig.base.json         # общий строгий tsconfig
├─ docker-compose.yml         # PostgreSQL 16 для разработки (порт 5544)
├─ docs/PLAN.md               # поэтапный план MVP и ключевые решения
│
├─ packages/shared/           # @tokencontrol/shared — единый источник типов
│  └─ src/
│     ├─ domain.ts            # ActionType, объекты сектора, слоты очереди, параметры действий
│     ├─ config.ts            # форма GameConfig (стоимости, формула, лимиты) + дефолты
│     ├─ api.ts               # DTO всех эндпоинтов и WS-сообщений (импортируют сервер и клиент)
│     └─ index.ts             # реэкспорт
│
├─ server/                    # игровой сервер: Fastify + Drizzle + PostgreSQL
│  ├─ drizzle.config.ts       # конфиг drizzle-kit (генерация миграций)
│  ├─ vitest.config.ts        # тесты последовательно (общая тестовая БД)
│  ├─ scripts/feed.ts         # фейковый коннектор: качает синтетические ОВМ
│  ├─ test/                   # vitest: worldgen, API, движок очереди/начислений
│  └─ src/
│     ├─ index.ts             # bootstrap: миграции, регенерация, hot-reload конфига, listen
│     ├─ app.ts               # сборка Fastify-приложения (JWT, WS, маршруты) — используется тестами
│     ├─ ws.ts                # реестр WS-подключений по игрокам, push/broadcast
│     ├─ db/
│     │  ├─ schema.ts         # все 10 таблиц (players, ships, queues, cargo, sectors,
│     │  │                    #   objects, known_objects, visited_sectors, action_log,
│     │  │                    #   credit_ledger, game_config)
│     │  ├─ client.ts         # подключение postgres.js + drizzle
│     │  ├─ migrate.ts        # применение миграций (старт сервера и тесты)
│     │  └─ migrations/       # сгенерированный SQL (drizzle-kit generate)
│     ├─ game/                # игровая логика (вся — внутри транзакций)
│     │  ├─ rng.ts            # детерминированный PRNG (xmur3 + mulberry32)
│     │  ├─ worldgen.ts       # генерация содержимого сектора по сиду, соседство секторов
│     │  ├─ world.ts          # ленивая генерация при первом визите, пометка «посещён»
│     │  ├─ config.ts         # загрузка game_config из БД с дефолтами
│     │  ├─ state.ts          # снапшот StateResponse (переиспользуют все маршруты)
│     │  ├─ actions.ts        # 7 действий: валидация (enqueue/activate) + исполнение
│     │  ├─ queue.ts          # движок очереди: слоты, буфер ОВМ, каскад излишка, НЕВЫПОЛНИМО
│     │  ├─ credits.ts        # идемпотентный приём пакетов ОВМ + лимиты анти-абуза
│     │  └─ regen.ts          # восстановление запасов астероидов по таймеру
│     └─ routes/              # тонкие HTTP-обработчики поверх game/
│        ├─ auth.ts           # POST /auth/dev (Steam — фаза 6), создание игрока и корабля
│        ├─ state.ts          # GET /state
│        ├─ map.ts            # GET /map/sector (только открытое), GET /map/galaxy
│        ├─ queue.ts          # queue/add|remove|reorder, ship/undock
│        ├─ credits.ts        # POST /credits/submit (от коннектора)
│        └─ log.ts            # GET /log — журнал с курсором
│
└─ client/                    # Tauri-приложение
   ├─ vite.config.ts          # dev-прокси /api и /ws → сервер :8787
   ├─ index.html              # точка входа веб-части
   ├─ src/                    # веб-UI: Svelte 5 (runes)
   │  ├─ main.ts, app.css     # монтирование и терминальная тема (палитра, панели)
   │  ├─ App.svelte           # оболочка: шапка-телеметрия, меню 1-7, экраны, строка сообщений
   │  ├─ Login.svelte         # dev-вход по позывному
   │  ├─ lib/
   │  │  ├─ api.ts            # типизированный HTTP-клиент + WS с реконнектом
   │  │  ├─ game.svelte.ts    # реактивное состояние игры, постановка действий, polling
   │  │  ├─ connector.svelte.ts # мост к Rust-коннектору (Tauri invoke/events, фолбэк в браузере)
   │  │  ├─ i18n.svelte.ts    # локализация RU/EN (русские строки — ключи словаря)
   │  │  └─ terminal/
   │  │     ├─ format.ts      # ASCII-прогресс-бары, форматирование ОВМ
   │  │     ├─ keys.ts        # нормализация имён клавиш
   │  │     └─ Crt.svelte     # отключаемый CRT-слой (сканлайны + виньетка)
   │  └─ screens/             # 7 экранов ТЗ п. 4.2
   │     ├─ Queue.svelte      # очередь: слоты, добавление, удаление с подтверждением
   │     ├─ SectorMap.svelte  # ASCII-карта сектора, курсор, выбор цели/точки
   │     ├─ GalaxyMap.svelte  # сетка галактики, выбор цели гиперпрыжка
   │     ├─ Cargo.svelte      # трюм и вместимость
   │     ├─ Status.svelte     # корабль, накопитель ОВМ, статус коннектора
   │     ├─ Journal.svelte    # журнал операций
   │     └─ Settings.svelte   # CRT, язык, коннектор, аккаунт
   └─ src-tauri/              # Rust-часть
      ├─ tauri.conf.json      # окно, сборка, идентификатор приложения
      ├─ Cargo.toml
      └─ src/
         ├─ main.rs           # точка входа десктоп-приложения
         ├─ lib.rs            # Tauri: команды connector_start/stop, события, трей, скрытие в трей
         ├─ bin/connector_cli.rs # коннектор без окна — для отладки
         └─ connector/        # коннектор Claude Code (ТЗ п. 7)
            ├─ mod.rs         # цикл: рескан 10с → дедуп → ОВМ → outbox → отправка 30с; baseline
            ├─ parser.rs      # чтение JSONL с офсетов; только числовые поля, текст не читается
            ├─ store.rs       # SQLite: офсеты, дедуп-индекс, оффлайн-outbox, дробный остаток
            └─ submit.rs      # HTTP: /config (коэффициенты) и /credits/submit
```

## Что дальше

Фаза 6 (Steam): авторизация auth ticket вместо dev-заглушки, сборки/депо, страница, privacy policy — см. [docs/PLAN.md](docs/PLAN.md).
