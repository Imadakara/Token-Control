/**
 * Сброс игрового мира (Strategy - Plan.md, Фаза 13): очищает флот, сектора,
 * объекты, знания и Цепь Миров, но НЕ трогает `credit_ledger` и `game_config`.
 *
 * `credit_ledger` хранит (player_id, packet_seq) — монотонность packetSeq
 * важна для дедупликации коннектора (rusqlite outbox переживает рестарты и
 * повторяет неподтверждённые пакеты); очистка ledger рассинхронизировала бы
 * коннектор с сервером после сброса мира. `game_config` — операционная
 * калибровка (стоимости, лимиты, формула), а не состояние игрового мира;
 * сброс баланса — отдельное осознанное действие, не побочный эффект вайпа.
 *
 * ВАЖНО: строки `players` тоже НЕ удаляются, а только сбрасываются
 * (`ovm_buffer`, `home_sector_id`) — `credit_ledger.player_id` ссылается на
 * `players.id`, и `TRUNCATE ... CASCADE` на `players` молча каскадирует
 * ЛЮБые ссылающиеся таблицы независимо от их `ON DELETE` (это поведение
 * `TRUNCATE`, не `DELETE`) — то есть удалил бы и ledger вместе с игроками.
 * Единственный способ сохранить ledger при живой FK-связи — не трогать сами
 * строки players.
 *
 * Использование: npx tsx scripts/wipe.ts --yes
 */
import { createDb, DATABASE_URL } from '../src/db/client';

const confirmed = process.argv.includes('--yes') || process.argv.includes('-y');
if (!confirmed) {
  console.error(
    '[wipe] Это ОЧИСТИТ флот, сектора, объекты, знания и Цепь Миров, сбросит буфер ОВМ игроков.\n' +
      '[wipe] credit_ledger и game_config НЕ трогаются.\n' +
      '[wipe] Повторите с флагом --yes, если это осознанное действие.',
  );
  process.exit(1);
}

const { sql } = createDb(DATABASE_URL);
try {
  await sql`
    TRUNCATE TABLE
      chain_keys, sector_links, player_tech, player_knowledge,
      action_log, cargo, visited_sectors, known_objects, objects,
      sectors, queues, entities
  `;
  await sql`UPDATE players SET ovm_buffer = '0', home_sector_id = NULL`;
  console.log('[wipe] Мир очищен, буфер игроков сброшен. credit_ledger и game_config сохранены.');
} finally {
  await sql.end();
}
