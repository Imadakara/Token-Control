import type { CreditsSubmitRequest, CreditsSubmitResponse } from '@tokencontrol/shared';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { creditLedger } from '../db/schema';
import type { ServerConfig } from './config';
import { applyOvm, lockPlayer } from './queue';
import { r3 } from './state';

/**
 * Приём пакета ОВМ от коннектора (ТЗ п. 7.4, п. 9).
 * Идемпотентность: UNIQUE(player_id, packet_seq) — повтор пакета возвращает
 * прежний результат и ничего не начисляет. Лимиты урезают, а не банят.
 */
export async function submitCredits(
  db: Db,
  cfg: ServerConfig,
  pid: string,
  req: CreditsSubmitRequest,
): Promise<CreditsSubmitResponse> {
  return db.transaction(async (tx) => {
    await lockPlayer(tx, pid);

    // Повтор пакета? Отвечаем как в первый раз, без начисления.
    const [existing] = await tx
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.playerId, pid), eq(creditLedger.packetSeq, req.packetSeq)));
    if (existing) {
      const accepted = Number(existing.ovmAccepted);
      return { accepted, clipped: r3(Number(existing.ovmSubmitted) - accepted) };
    }

    const submitted = r3(Math.max(0, req.ovm));
    const accepted = r3(Math.min(submitted, await remainingAllowance(tx, cfg, pid)));

    await tx.insert(creditLedger).values({
      playerId: pid,
      packetSeq: req.packetSeq,
      ovmSubmitted: String(submitted),
      ovmAccepted: String(accepted),
      tokens: req.tokens,
      intervalStart: new Date(req.intervalStart),
      intervalEnd: new Date(req.intervalEnd),
    });

    if (accepted > 0) {
      await applyOvm({ db: tx, cfg, pid }, accepted);
    }

    return { accepted, clipped: r3(submitted - accepted) };
  });
}

/** Мягкое отсечение: сколько ОВМ ещё можно принять в минутном/часовом/суточном окнах. */
async function remainingAllowance(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  cfg: ServerConfig,
  pid: string,
): Promise<number> {
  const { maxOvmPerMinute, maxOvmPerHour, maxOvmPerDay } = cfg.game.limits;
  const windows: [number, number][] = [
    [60_000, maxOvmPerMinute],
    [3_600_000, maxOvmPerHour],
    [86_400_000, maxOvmPerDay],
  ];
  let allowance = Infinity;
  for (const [ms, cap] of windows) {
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${creditLedger.ovmAccepted}), 0)` })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.playerId, pid),
          gte(creditLedger.receivedAt, new Date(Date.now() - ms)),
        ),
      );
    allowance = Math.min(allowance, cap - Number(row?.total ?? 0));
  }
  return Math.max(0, allowance);
}
