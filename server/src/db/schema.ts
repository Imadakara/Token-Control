import {
  bigint,
  bigserial,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/** Игроки. id: "dev:<name>" в dev-режиме, позже "steam:<steam_id>". */
export const players = pgTable('players', {
  id: text('id').primaryKey(),
  steamId: text('steam_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Системный буфер ОВМ (ТЗ п. 5), дробная часть — серверная. */
  ovmBuffer: numeric('ovm_buffer', { precision: 14, scale: 3 }).notNull().default('0'),
  params: jsonb('params').notNull().default({}),
  /** Псевдослучайный домашний сектор игрока (ТЗ v0.02 п. 4). */
  homeSectorId: text('home_sector_id'),
});

/**
 * Флот игрока (ТЗ v0.02 п. 2): корабли И стационарные объекты (врата, постройки)
 * — одной таблицей, различаются через ENTITY_CLASSES[classId].mobile.
 * class_id и modules — ключи статичного каталога из @tokencontrol/shared.
 */
export const entities = pgTable('entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: text('player_id')
    .notNull()
    .references(() => players.id),
  name: text('name').notNull(),
  classId: text('class_id').notNull(),
  sectorId: text('sector_id').notNull(),
  x: doublePrecision('x').notNull(),
  y: doublePrecision('y').notNull(),
  dockedObjectId: uuid('docked_object_id'),
  /** ModuleId[]; отдельная таблица появится вместе с установкой/снятием модулей. */
  modules: jsonb('modules').notNull().default([]),
  hp: integer('hp').notNull(),
  hpMax: integer('hp_max').notNull(),
  /** Порядок раздачи ОВМ: меньше — раньше (ТЗ v0.02 п. 3). */
  priority: smallint('priority').notNull().default(100),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Очередь приказов: до GameConfig.orderSlots строк на СУЩНОСТЬ, slot 1 — активный.
 * player_id денормализован намеренно: он нужен lockPlayer и свипу, иначе каждый
 * тик свипа становится джойном.
 */
export const queues = pgTable(
  'queues',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    slot: smallint('slot').notNull(),
    actionType: text('action_type').notNull(),
    params: jsonb('params'),
    costOvm: numeric('cost_ovm', { precision: 14, scale: 3 }).notNull(),
    progressOvm: numeric('progress_ovm', { precision: 14, scale: 3 }).notNull().default('0'),
    status: text('status').notNull().default('waiting'),
    /** Момент активации; исполнение — не раньше activated_at + кулдаун. */
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.slot] }), index('queues_player_idx').on(t.playerId)],
);

/** Сектора создаются лениво при первом визите (генерация детерминирована сидом). */
export const sectors = pgTable('sectors', {
  id: text('id').primaryKey(), // "gx:gy"
  gx: integer('gx').notNull(),
  gy: integer('gy').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const objects = pgTable('objects', {
  id: uuid('id').primaryKey().defaultRandom(),
  sectorId: text('sector_id')
    .notNull()
    .references(() => sectors.id),
  type: text('type').notNull(), // station | asteroid | container | phenomenon
  x: doublePrecision('x').notNull(),
  y: doublePrecision('y').notNull(),
  /** Скрытые свойства, раскрываются анализом (ТЗ п. 6.5). */
  props: jsonb('props').notNull().default({}),
  resourceType: text('resource_type'),
  resourceAmount: integer('resource_amount'),
  maxResource: integer('max_resource'),
  respawnAt: timestamp('respawn_at', { withTimezone: true }),
});

/** Что игрок открыл сканированием/анализом. */
export const knownObjects = pgTable(
  'known_objects',
  {
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objects.id),
    level: text('level').notNull(), // scanned | analyzed
  },
  (t) => [primaryKey({ columns: [t.playerId, t.objectId] })],
);

export const visitedSectors = pgTable(
  'visited_sectors',
  {
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    sectorId: text('sector_id').notNull(),
    visitedAt: timestamp('visited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.sectorId] })],
);

/**
 * Трюм: ресурсы (kind=resource, qty) и подобранные объекты (kind=object).
 * Привязан к СУЩНОСТИ — груз физически локализован (ТЗ v0.02 п. 3.2: добыча
 * возможна только в тех же координатах). player_id оставлен для дешёвых выборок.
 */
export const cargo = pgTable('cargo', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => entities.id),
  playerId: text('player_id')
    .notNull()
    .references(() => players.id),
  kind: text('kind').notNull(), // resource | object
  itemType: text('item_type').notNull(),
  qty: integer('qty').notNull().default(1),
  props: jsonb('props'),
});

export const actionLog = pgTable('action_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  playerId: text('player_id')
    .notNull()
    .references(() => players.id),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  action: text('action').notNull(),
  result: text('result').notNull(),
  details: jsonb('details'),
});

/** Входящие пакеты ОВМ; UNIQUE(player_id, packet_seq) — идемпотентность. */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    packetSeq: bigint('packet_seq', { mode: 'number' }).notNull(),
    ovmSubmitted: numeric('ovm_submitted', { precision: 14, scale: 3 }).notNull(),
    ovmAccepted: numeric('ovm_accepted', { precision: 14, scale: 3 }).notNull(),
    tokens: jsonb('tokens').notNull(),
    intervalStart: timestamp('interval_start', { withTimezone: true }).notNull(),
    intervalEnd: timestamp('interval_end', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.playerId, t.packetSeq)],
);

/** Серверный игровой конфиг (ТЗ п. 12.2). */
export const gameConfig = pgTable('game_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

/**
 * База Знаний и Технологии (ТЗ v0.02 пп. 5–6): контент — статичный каталог в
 * @tokencontrol/shared, здесь только прогресс игрока. entry_id/tech_id —
 * ключи каталога, не FK: контент версионируется в коде, не в БД.
 */
export const playerKnowledge = pgTable(
  'player_knowledge',
  {
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    entryId: text('entry_id').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.entryId] })],
);

export const playerTech = pgTable(
  'player_tech',
  {
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    techId: text('tech_id').notNull(),
    researchedAt: timestamp('researched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.techId] })],
);

/**
 * Цепь Миров (ТЗ v0.02 п. 4): рёбра — глобальные и общие для всех игроков
 * (топология Цепи не скрыта, в отличие от содержимого секторов). Ребро
 * неориентированное — хранится один раз, a_sector_id < b_sector_id
 * лексикографически (canonicalPair в game/chain.ts), иначе (a,b) и (b,a)
 * считались бы разными рёбрами.
 */
export const sectorLinks = pgTable(
  'sector_links',
  {
    aSectorId: text('a_sector_id').notNull(),
    bSectorId: text('b_sector_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.aSectorId, t.bSectorId] })],
);

/**
 * Ключ Цепи Миров — точка монетизации (ТЗ п. 4): реальную продажу выдаёт
 * Steam в фазе 99, здесь только механика потребления. target_sector_id null —
 * ключ «в случайный подключённый мир», конкретный сектор выбирается при
 * применении (game/chain.ts).
 */
export const chainKeys = pgTable('chain_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: text('player_id')
    .notNull()
    .references(() => players.id),
  targetSectorId: text('target_sector_id'),
  source: text('source').notNull().default('debug'),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});
