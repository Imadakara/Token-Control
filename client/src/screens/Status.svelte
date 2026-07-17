<script lang="ts">
  import { api } from '../lib/api';
  import { connector } from '../lib/connector.svelte';
  import { game } from '../lib/game.svelte';
  import { fmtOvm } from '../lib/terminal/format';

  const ship = $derived(game.state?.ship ?? null);

  async function undock() {
    try {
      game.state = await api.undock();
      game.say('РАССТЫКОВКА ВЫПОЛНЕНА');
    } catch (err) {
      game.say(`ОТКАЗ: ${(err as Error).message}`);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (game.screen !== 'status') return;
    if (e.key.toLowerCase() === 'u' && ship?.dockedObjectId) void undock();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="panel">
  <div class="panel-title">СТАТУС КОРАБЛЯ</div>
  {#if ship}
    <pre>
СЕКТОР ............... {ship.sectorId}
КООРДИНАТЫ ........... [{ship.x}; {ship.y}]
СТЫКОВКА ............. {ship.dockedObjectId ? 'ПРИСТЫКОВАН [U — РАССТЫКОВКА]' : 'СВОБОДНЫЙ ПОЛЁТ'}
</pre>
  {/if}
</div>

<div class="panel" style="margin-top:0.5rem">
  <div class="panel-title">НАКОПИТЕЛЬ ОВМ</div>
  <pre>
ВХОДЯЩИЙ ПОТОК ....... {fmtOvm(game.ratePerMin)} ОВМ/МИН
БУФЕР ................ {fmtOvm(game.state?.ovmBuffer ?? 0)} / {fmtOvm(game.config?.ovmBufferCap ?? 0)}
</pre>
</div>

<div class="panel" style="margin-top:0.5rem">
  <div class="panel-title">КОННЕКТОР CLAUDE CODE</div>
  {#if connector.status}
    {@const s = connector.status}
    <pre>
СТАТУС ............... {s.running ? 'РАБОТАЕТ' : 'ОСТАНОВЛЕН'}
АГЕНТ ................ {s.agentDetected ? `ОБНАРУЖЕН (ФАЙЛОВ: ${s.filesTracked})` : 'ТИШИНА'}
ЗАПИСЕЙ ЗАСЧИТАНО .... {s.freshRecords}
ОЖИДАЕТ ОТПРАВКИ ..... {fmtOvm(s.outboxOvm)} ОВМ
ПОСЛЕДНИЙ ПАКЕТ ...... ПРИНЯТО {fmtOvm(s.lastAccepted)} / УРЕЗАНО {fmtOvm(s.lastClipped)}
{#if s.lastError}<span class="err">ОШИБКА ............... {s.lastError}</span>{/if}</pre>
  {:else if connector.isTauri}
    <pre class="dim">СТАТУС ............... ЗАПУСК...</pre>
  {:else}
    <pre class="dim">СТАТУС ............... НЕДОСТУПЕН В БРАУЗЕРНОЙ ВЕРСИИ
ЗАПУСТИТЕ ДЕСКТОП-ОБОЛОЧКУ: npm run tauri dev</pre>
  {/if}
</div>
