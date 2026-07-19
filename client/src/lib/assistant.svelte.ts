import {
  ACTION_TYPES,
  ENTITY_CLASSES,
  type ActionParams,
  type ActionType,
  type EntityState,
  type GalaxyMapResponse,
  type KnowledgeEntry,
  type OrdersAvailableResponse,
  type StateResponse,
  type TechStatus,
} from '@tokencontrol/shared';
import { ACTION_LABELS } from './game.svelte';
import { t } from './i18n.svelte';

/**
 * ИИ-ассистент (ТЗ v0.02 п. 7): разговор с локальной OpenAI-совместимой LLM
 * (Ollama) идёт целиком с клиента — сервер только выдаёт контекст и списывает
 * ОВМ (routes/assistant.ts). Ассистент физически не может ничего сверх того,
 * что доступно самому игроку: единственный канал действия — два tool'а ниже,
 * а их резолв сверяется с тем же /orders/available и /tech, что видит UI.
 *
 * Без стриминга (см. Strategy - Plan.md, Фаза 12): у OpenAI-совместимого API
 * стриминг означает склейку tool_calls[].function.arguments по чанкам, а
 * именно tool-call — ядро фичи, не просто чат. Обычный ответ надёжнее.
 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

class AssistantSettings {
  baseUrl = $state(localStorage.getItem('tc_assistant_url') ?? 'http://127.0.0.1:11434/v1');
  model = $state(localStorage.getItem('tc_assistant_model') ?? 'qwen2.5:3b');

  setBaseUrl(url: string): void {
    this.baseUrl = url;
    localStorage.setItem('tc_assistant_url', url);
  }
  setModel(model: string): void {
    this.model = model;
    localStorage.setItem('tc_assistant_model', model);
  }
}

export const assistantSettings = new AssistantSettings();

/** Единственная развилка транспорта: в Tauri — через плагин (Rust, без CORS). */
async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url, init);
  }
  return fetch(url, init);
}

export async function checkConnection(): Promise<boolean> {
  try {
    const res = await httpFetch(`${assistantSettings.baseUrl}/models`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Живая проверка наличия конкретной модели по текущему адресу — в отличие
 * от ollamaAutoStatus.modelAvailable, которая обновляется один раз при входе
 * в игру (ensureOllamaRunning) и может устареть: sidecar мог подняться уже
 * ПОСЛЕ той проверки, либо игрок сменил адрес/модель в Настройках. Вызывается
 * при открытии экранов Ассистента/Настроек и повторно прямо перед показом
 * диалога загрузки — чтобы «скачать модель» не могло появиться на экране без
 * свежей проверки того, что модели действительно нет.
 */
export async function refreshModelAvailability(): Promise<boolean | null> {
  try {
    const res = await httpFetch(`${assistantSettings.baseUrl}/models`, { method: 'GET' });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { id: string }[] | null };
    const available = (body.data ?? []).some((m) => m.id === assistantSettings.model);
    ollamaAutoStatus.state = 'running';
    ollamaAutoStatus.modelAvailable = available;
    return available;
  } catch {
    return null;
  }
}

/** Корень Ollama-API без OpenAI-совместимого суффикса /v1 — там живёт /api/pull. */
function apiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '');
}

function isLocalOllamaUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === '127.0.0.1' || hostname === 'localhost';
  } catch {
    return false;
  }
}

class OllamaAutoStatus {
  /** 'idle' — ещё не проверяли в этой сессии. */
  state = $state<'idle' | 'running' | 'unavailable'>('idle');
  modelAvailable = $state<boolean | null>(null);
}

export const ollamaAutoStatus = new OllamaAutoStatus();

/**
 * Встроенный движок (Strategy - Plan.md): если по настроенному локальному
 * адресу уже кто-то отвечает (свой Ollama игрока, в т.ч. с GPU-ускорением) —
 * не трогаем; иначе поднимаем sidecar, зашитый в сборку (game/ollama.rs).
 * Только внутри Tauri и только для локального адреса — best-effort, ошибка
 * не должна ничего ломать (ручная «ПРОВЕРИТЬ» остаётся рабочей независимо).
 */
export async function ensureOllamaRunning(): Promise<void> {
  if (!isTauri() || !isLocalOllamaUrl(assistantSettings.baseUrl)) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const status = await invoke<{ state: string; modelAvailable: boolean | null }>(
      'ollama_ensure_running',
      { baseUrl: assistantSettings.baseUrl, model: assistantSettings.model },
    );
    ollamaAutoStatus.state = status.state === 'running' ? 'running' : 'unavailable';
    ollamaAutoStatus.modelAvailable = status.modelAvailable;
  } catch {
    /* best-effort — ручная проверка в Настройках остаётся рабочим путём */
  }
}

interface PullProgress {
  status: string;
  percent: number | null;
}

/**
 * Скачивание модели — ТОЛЬКО по явному действию игрока (клик по кнопке),
 * никогда не вызывается автоматически: это разовая загрузка ~2 ГБ.
 */
export async function pullModel(
  model: string,
  onProgress: (p: PullProgress) => void,
): Promise<void> {
  const res = await httpFetch(`${apiRoot(assistantSettings.baseUrl)}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line) as { status: string; completed?: number; total?: number; error?: string };
      if (chunk.error) throw new Error(chunk.error);
      const percent =
        chunk.total && chunk.completed ? Math.round((chunk.completed / chunk.total) * 100) : null;
      onProgress({ status: chunk.status, percent });
    }
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'issue_order',
      description:
        'Поставить приказ сущности флота игрока. Значения полей БЕРИ ТОЛЬКО из ' +
        'сводки флота, приложенной в system-сообщении (строки вида \'- «ИМЯ» ' +
        '(класс: ..., статус: ..., сектор: ...): приказ(цели: МЕТКА1, МЕТКА2)\') — ' +
        'никогда не копируй значения из описания этой функции, здесь только формат ' +
        'полей, не реальные данные. ВСЕГДА используй именно эти имена полей — ' +
        'entityName, action, targetLabel/sectorId/x/y — никаких других имён полей.',
      parameters: {
        type: 'object',
        properties: {
          entityName: {
            type: 'string',
            description:
              'Имя сущности — ТОЛЬКО текст в кавычках-«ёлочках» «...» в начале строки ' +
              'сводки флота. Это НЕ класс (то, что после "класс:") и НЕ статус. ' +
              'Копируй символы как есть, без кавычек-«ёлочек» — если имя написано ' +
              'кириллицей, не заменяй буквы на похожую латиницу.',
          },
          action: {
            type: 'string',
            description: 'Идентификатор приказа из сводки флота ровно как он там написан (attack, mine, move, jump_hyper и т.п.)',
          },
          targetLabel: {
            type: 'string',
            description: 'Метка цели ровно как она перечислена в скобках "цели: ..." у выбранного приказа в сводке флота',
          },
          sectorId: { type: 'string', description: 'ID сектора назначения для jump_hyper, из списка достижимых в сводке' },
          x: { type: 'number', description: 'Координата X для приказов с точкой (move, build_gate)' },
          y: { type: 'number', description: 'Координата Y для приказов с точкой' },
        },
        required: ['entityName', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'research_tech',
      description:
        'Исследовать технологию, если она готова к изучению. techTitle бери ' +
        'только из реального названия технологии, упомянутого в разговоре или ' +
        'Базе Знаний — не выдумывай.',
      parameters: {
        type: 'object',
        properties: {
          techTitle: { type: 'string', description: 'Точное название технологии' },
        },
        required: ['techTitle'],
      },
    },
  },
] as const;

/** Компактная сводка флота — контекст для модели, без нового сетевого похода. */
export function buildFleetContext(
  state: StateResponse,
  available: OrdersAvailableResponse,
  galaxy: GalaxyMapResponse | null,
): string {
  const byEntity = new Map(available.entities.map((e) => [e.entityId, e.orders]));
  const lines = state.entities.map((e) => {
    const orders = byEntity.get(e.id) ?? [];
    const parts = orders
      .filter((o) => o.available)
      .map((o) => {
        if (o.target === 'object' && o.candidates?.length) {
          return `${o.action}(цели: ${o.candidates.map((c) => c.label).join(', ')})`;
        }
        if (o.target === 'sector' && galaxy?.reachable.length) {
          return `${o.action}(секторы: ${galaxy.reachable.join(', ')})`;
        }
        return o.action;
      });
    const className = ENTITY_CLASSES[e.classId]?.title ?? e.classId;
    return `- «${e.name}» (класс: ${className}, статус: ${e.status}, сектор: ${e.sectorId}): ${
      parts.length > 0 ? parts.join('; ') : 'нет доступных приказов'
    }`;
  });
  return lines.join('\n');
}

function buildKnowledgeContext(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) return '(база знаний пуста)';
  return entries.map((e) => `${e.title}: ${e.body}`).join('\n');
}

function safeParseJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Нестриминговый запрос к OpenAI-совместимому /chat/completions. */
export async function askAssistant(params: {
  userText: string;
  history: ChatMessage[];
  systemPrompt: string;
  entries: KnowledgeEntry[];
  fleetContext: string;
}): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  const systemMsg =
    `${params.systemPrompt}\n\nБАЗА ЗНАНИЙ:\n${buildKnowledgeContext(params.entries)}\n\n` +
    `ФЛОТ ИГРОКА:\n${params.fleetContext}`;

  const res = await httpFetch(`${assistantSettings.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: assistantSettings.model,
      stream: false,
      messages: [
        { role: 'system', content: systemMsg },
        ...params.history,
        { role: 'user', content: params.userText },
      ],
      tools: TOOLS,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { function: { name: string; arguments: string } }[];
      };
    }[];
  };
  const message = body.choices?.[0]?.message;
  if (!message) throw new Error('ПУСТОЙ ОТВЕТ МОДЕЛИ');
  const toolCalls = (message.tool_calls ?? []).map((c) => ({
    name: c.function.name,
    arguments: safeParseJson(c.function.arguments),
  }));
  return { content: message.content ?? null, toolCalls };
}

// ---- Резолв tool-call'ов: свободный текст модели никогда не исполняется,
// только структурированный вызов из TOOLS, сверенный с реальными данными ----

export type ResolvedCall =
  | { kind: 'order'; entityId: string; action: ActionType; params: ActionParams | null; description: string }
  | { kind: 'research'; techId: string; description: string }
  | { kind: 'error'; message: string };

export interface AssistantCtx {
  state: StateResponse;
  available: OrdersAvailableResponse;
  galaxy: GalaxyMapResponse | null;
  techs: TechStatus[];
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/**
 * Небольшие локальные модели иногда транслитерируют кириллические имена
 * латиницей (БОРТ-002 → BORT-002) — сравниваем по фонетическому «скелету»,
 * а не только точным/подстрочным совпадением.
 */
function translitKey(s: string): string {
  return s
    .toLowerCase()
    .split('')
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

function findEntityByName(state: StateResponse, name: string): EntityState | undefined {
  const lower = name.trim().toLowerCase();
  const key = translitKey(name);
  return (
    state.entities.find((e) => e.name.toLowerCase() === lower) ??
    state.entities.find((e) => e.name.toLowerCase().includes(lower)) ??
    // Модель иногда копирует не только имя, но и весь описательный кусок
    // сводки вокруг него («ИМЯ» (класс: ..., статус: ...)) — ищем известное
    // имя сущности КАК ПОДСТРОКУ внутри такого «мусорного» аргумента.
    state.entities.find((e) => lower.includes(e.name.toLowerCase())) ??
    state.entities.find((e) => translitKey(e.name) === key)
  );
}

/** Модель иногда копирует и обрамляющие кавычки-«ёлочки» из сводки флота. */
function stripQuotes(s: string): string {
  return s.trim().replace(/^[«"']+|[»"']+$/g, '');
}

function resolveIssueOrder(args: Record<string, unknown>, ctx: AssistantCtx): ResolvedCall {
  const entityName = typeof args.entityName === 'string' ? stripQuotes(args.entityName) : '';
  const action = typeof args.action === 'string' ? args.action : '';
  if (!entityName) return { kind: 'error', message: 'Ассистент не указал сущность.' };
  const entity = findEntityByName(ctx.state, entityName);
  if (!entity) return { kind: 'error', message: `Сущность «${entityName}» не найдена во флоте.` };

  if (!(ACTION_TYPES as readonly string[]).includes(action)) {
    return { kind: 'error', message: `Неизвестный приказ «${action}».` };
  }
  const typedAction = action as ActionType;

  const options = ctx.available.entities.find((e) => e.entityId === entity.id)?.orders ?? [];
  const option = options.find((o) => o.action === typedAction);
  if (!option || !option.available) {
    const reason = option?.reason ?? 'приказ недоступен';
    return {
      kind: 'error',
      message: `${entity.name}: ${t(ACTION_LABELS[typedAction])} недоступен — ${reason}.`,
    };
  }

  let params: ActionParams | null = null;
  let targetDesc = '';
  if (option.target === 'object') {
    const label = typeof args.targetLabel === 'string' ? args.targetLabel.trim().toLowerCase() : '';
    const candidate =
      option.candidates?.find((c) => c.label.toLowerCase() === label) ??
      option.candidates?.find((c) => c.label.toLowerCase().includes(label));
    if (!candidate) {
      return {
        kind: 'error',
        message: `Цель «${String(args.targetLabel ?? '')}» не найдена среди кандидатов для ${entity.name}.`,
      };
    }
    params = { kind: 'object', objectId: candidate.objectId };
    targetDesc = candidate.label;
  } else if (option.target === 'sector') {
    const sectorId = typeof args.sectorId === 'string' ? args.sectorId : '';
    if (!ctx.galaxy?.reachable.includes(sectorId)) {
      return { kind: 'error', message: `Сектор «${sectorId}» недостижим для ${entity.name}.` };
    }
    params = { kind: 'sector', sectorId };
    targetDesc = `сектор ${sectorId}`;
  } else if (option.target === 'point') {
    const x = Number(args.x);
    const y = Number(args.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { kind: 'error', message: `Для приказа «${typedAction}» нужны координаты x/y.` };
    }
    params = { kind: 'point', x, y };
    targetDesc = `[${x}; ${y}]`;
  }

  const description = `${t(ACTION_LABELS[typedAction])} — ${entity.name}${targetDesc ? ` → ${targetDesc}` : ''}`;
  return { kind: 'order', entityId: entity.id, action: typedAction, params, description };
}

function resolveResearchTech(args: Record<string, unknown>, ctx: AssistantCtx): ResolvedCall {
  const titleArg = typeof args.techTitle === 'string' ? args.techTitle : '';
  const title = titleArg.trim().toLowerCase();
  if (!title) return { kind: 'error', message: 'Ассистент не указал технологию.' };
  const tech =
    ctx.techs.find((tc) => tc.title.toLowerCase() === title) ??
    ctx.techs.find((tc) => tc.title.toLowerCase().includes(title));
  if (!tech) return { kind: 'error', message: `Технология «${titleArg}» не найдена.` };
  if (tech.researched) return { kind: 'error', message: `${tech.title} уже изучена.` };
  if (!tech.researchable) return { kind: 'error', message: `${tech.title} пока не готова к изучению.` };
  return {
    kind: 'research',
    techId: tech.id,
    description: `${t('ИЗУЧИТЬ')} «${tech.title}» ${t('ЗА')} ${tech.dataCost.ovm} ${t('ОВМ')}`,
  };
}

export function resolveToolCall(call: ToolCall, ctx: AssistantCtx): ResolvedCall {
  if (call.name === 'issue_order') return resolveIssueOrder(call.arguments, ctx);
  if (call.name === 'research_tech') return resolveResearchTech(call.arguments, ctx);
  return { kind: 'error', message: `Ассистент вызвал неизвестную функцию «${call.name}».` };
}
