/**
 * Фейковый коннектор для разработки: качает синтетические ОВМ на сервер.
 * Использование: npx tsx scripts/feed.ts [player] [ovmPerPacket] [intervalSec]
 */
const [, , player = 'misha', ovmArg = '25', intervalArg = '5'] = process.argv;
const BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:8787';
const ovmPerPacket = Number(ovmArg);
const intervalSec = Number(intervalArg);

const authRes = await fetch(`${BASE}/auth/dev`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ playerId: player }),
});
if (!authRes.ok) throw new Error(`auth failed: ${authRes.status}`);
const { token } = (await authRes.json()) as { token: string };
console.log(`[feed] игрок dev:${player}, ${ovmPerPacket} ОВМ каждые ${intervalSec}с — Ctrl+C для остановки`);

let last = Date.now();
for (;;) {
  const now = Date.now();
  const res = await fetch(`${BASE}/credits/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      packetSeq: now,
      ovm: ovmPerPacket,
      tokens: {
        input: ovmPerPacket * 800,
        output: ovmPerPacket * 200,
        cacheCreation: 0,
        cacheRead: 0,
      },
      intervalStart: new Date(last).toISOString(),
      intervalEnd: new Date(now).toISOString(),
    }),
  });
  const body = (await res.json()) as { accepted?: number; clipped?: number; error?: string };
  console.log(
    `[feed] ${new Date().toLocaleTimeString()} → accepted=${body.accepted ?? '-'} clipped=${body.clipped ?? '-'}${body.error ? ` error=${body.error}` : ''}`,
  );
  last = now;
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}
