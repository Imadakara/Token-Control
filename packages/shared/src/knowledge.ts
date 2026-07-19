import type { ActionType } from './domain';
import type { EntityClassId, ModuleId } from './entities';

/**
 * Каталог Базы Знаний и Технологий (ТЗ v0.02 пп. 5–6). Контент, а не данные —
 * живёт в shared рядом с entities.ts; в БД хранится только прогресс игрока
 * (player_knowledge, player_tech).
 */

export const KNOWLEDGE_BRANCHES = ['nav', 'ind', 'def'] as const;
export type KnowledgeBranch = (typeof KNOWLEDGE_BRANCHES)[number];

export interface KnowledgeEntry {
  id: string;
  title: string;
  branch: KnowledgeBranch;
  body: string;
  tags: string[];
}

export const KNOWLEDGE_ENTRIES: readonly KnowledgeEntry[] = [
  {
    id: 'nav.basics',
    title: 'ОСНОВЫ НАВИГАЦИИ',
    branch: 'nav',
    body: 'Локальное перемещение в пределах сектора рассчитывается бортовым компьютером по актуальным данным сканирования. Точность прыжка зависит от свежести карты.',
    tags: ['навигация', 'прыжок', 'сектор'],
  },
  {
    id: 'nav.deep-space',
    title: 'ДАЛЬНИЙ КОСМОС',
    branch: 'nav',
    body: 'Пространство между секторами не заполнено — переход требует либо соседства секторов, либо стабильного канала через межзвёздные врата.',
    tags: ['навигация', 'гиперпрыжок', 'врата'],
  },
  {
    id: 'ind.ore-processing',
    title: 'ОБРАБОТКА РУДЫ',
    branch: 'ind',
    body: 'Астероиды сектора содержат ферум, силиций и иридий в разных концентрациях. Буровой лазер извлекает породу порциями, не разрушая тело астероида.',
    tags: ['добыча', 'ресурсы', 'астероид'],
  },
  {
    id: 'ind.automation',
    title: 'АВТОМАТИЗАЦИЯ ДОБЫЧИ',
    branch: 'ind',
    body: 'Дальнейшая механизация добывающих контуров требует калибровки под конкретный минеральный состав — данные собираются по каждому сектору отдельно.',
    tags: ['добыча', 'автоматизация'],
  },
  {
    id: 'def.ballistics',
    title: 'БАЛЛИСТИКА',
    branch: 'def',
    body: 'Кинетическое оружие требует точного расчёта упреждения по разнице скоростей и решения о применении силы, санкционированного протоколом обороны.',
    tags: ['оборона', 'оружие', 'атака'],
  },
] as const;

export type KnowledgeEntryId = (typeof KNOWLEDGE_ENTRIES)[number]['id'];

/**
 * Системный промпт ИИ-ассистента (ТЗ v0.02 п. 7). Контент, не код — как и
 * KNOWLEDGE_ENTRIES/TECHS. Сервер прикладывает его вместе с реально открытыми
 * игроком записями (см. game/assistant.ts); модель не видит ничего сверху.
 */
export const ASSISTANT_SYSTEM_PROMPT =
  'Ты — бортовой ассистент терминала TOKEN CONTROL. Отвечай кратко и по делу, ' +
  'на русском. Ты можешь отвечать на вопросы ТОЛЬКО в рамках информации из ' +
  'Базы Знаний, приложенной ниже в этом сообщении, и сводки флота игрока — ' +
  'не выдумывай факты сверх этого. ' +
  'Если игрок просит отдать приказ сущности флота или исследовать технологию, ' +
  'ты ОБЯЗАН вызвать ровно одну подходящую функцию (issue_order или ' +
  'research_tech) — не описывай действие текстом, а реально вызови функцию, ' +
  'с точными именами сущности/технологии и цели из приложенной сводки. Не ' +
  'изобретай сущности, приказы или цели, которых там нет. Только если ' +
  'запрошенное действительно невозможно (сущности/цели/технологии нет в ' +
  'сводке) — объясни это обычным текстом, не вызывая функцию.';

/**
 * Единый плагин-пойнт: что открывает исследованная технология. Читают
 * game/orders.ts (доступность приказа) и game/actions.ts (проверка при
 * исполнении). Не все капабилити подключены к движку в фазе 10 — только
 * `{kind:'order', order:'attack'}` реально гейтится (def.weapons); остальные
 * задекларированы как честный резерв для фаз 11+ (`nav.hyperjump` → фаза 11
 * с воротами) или ждут систем, которых пока нет (установка модулей).
 */
export type Capability =
  | { kind: 'order'; order: ActionType }
  | { kind: 'module'; moduleId: ModuleId }
  | { kind: 'class'; classId: EntityClassId }
  | { kind: 'build'; objectKind: string };

export interface Tech {
  id: string;
  title: string;
  branch: KnowledgeBranch;
  requires: string[];
  dataCost: { entryIds: string[]; ovm: number };
  unlocks: Capability[];
}

export const TECHS: readonly Tech[] = [
  {
    id: 'nav.survey',
    title: 'РАЗВЕДКА СЕКТОРА',
    branch: 'nav',
    requires: [],
    dataCost: { entryIds: ['nav.basics'], ovm: 500 },
    unlocks: [],
  },
  {
    id: 'nav.hyperjump',
    title: 'ГИПЕРПРЫЖОК',
    branch: 'nav',
    requires: ['nav.survey'],
    dataCost: { entryIds: ['nav.deep-space'], ovm: 2000 },
    // Подключение к validateAction('jump_hyper') и приказу build_gate — фаза 11.
    unlocks: [{ kind: 'order', order: 'jump_hyper' }, { kind: 'build', objectKind: 'gate' }],
  },
  {
    id: 'ind.mining',
    title: 'ГОРНОЕ ДЕЛО',
    branch: 'ind',
    requires: [],
    dataCost: { entryIds: ['ind.ore-processing'], ovm: 500 },
    unlocks: [],
  },
  {
    id: 'ind.refinery',
    title: 'ПЕРЕРАБОТКА',
    branch: 'ind',
    requires: ['ind.mining'],
    dataCost: { entryIds: ['ind.automation'], ovm: 2000 },
    // Модуль refinery ставится на сущность из коробки (roadmap: установка
    // модулей — ТЗ п. 81); реальной проверки пока нет, как и у 'special'.
    unlocks: [{ kind: 'module', moduleId: 'refinery' }],
  },
  {
    id: 'def.weapons',
    title: 'ВООРУЖЕНИЕ',
    branch: 'def',
    requires: [],
    dataCost: { entryIds: ['def.ballistics'], ovm: 500 },
    unlocks: [{ kind: 'order', order: 'attack' }],
  },
] as const;

export type TechId = (typeof TECHS)[number]['id'];

export function findTech(id: string): Tech | undefined {
  return TECHS.find((t) => t.id === id);
}

export function findKnowledgeEntry(id: string): KnowledgeEntry | undefined {
  return KNOWLEDGE_ENTRIES.find((e) => e.id === id);
}
