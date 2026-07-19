import { ASSISTANT_SYSTEM_PROMPT, KNOWLEDGE_ENTRIES, type KnowledgeEntry } from '@tokencontrol/shared';
import { eq } from 'drizzle-orm';
import { players } from '../db/schema';
import { unlockedEntryIds } from './knowledge';
import { lockPlayer, QueueError } from './queue';
import { r3, type DbLike } from './state';

/**
 * ИИ-ассистент (ТЗ v0.02 п. 7): сервер остаётся авторитетным источником того,
 * что ассистенту разрешено знать (только реально открытые записи Базы Знаний,
 * как у GET /knowledge — см. комментарий там) и сколько это стоит. Модель и
 * её ответ сервер не видит вовсе — это забота клиента (lib/assistant.ts).
 */
export async function prepareAssistantContext(
  db: DbLike,
  pid: string,
  costOvm: number,
): Promise<{ entries: KnowledgeEntry[]; systemPrompt: string; ovmBuffer: number }> {
  const buffer = await lockPlayer(db, pid);
  if (buffer < costOvm) throw new QueueError('НЕДОСТАТОЧНО ОВМ');

  const newBuffer = r3(buffer - costOvm);
  await db.update(players).set({ ovmBuffer: String(newBuffer) }).where(eq(players.id, pid));

  const known = await unlockedEntryIds(db, pid);
  return {
    entries: KNOWLEDGE_ENTRIES.filter((e) => known.has(e.id)),
    systemPrompt: ASSISTANT_SYSTEM_PROMPT,
    ovmBuffer: newBuffer,
  };
}
