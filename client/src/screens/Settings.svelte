<script lang="ts">
  import { connector } from '../lib/connector.svelte';
  import { game } from '../lib/game.svelte';

  function onKey(e: KeyboardEvent) {
    if (game.screen !== 'settings') return;
    if (e.key.toLowerCase() === 'c') game.toggleCrt();
    else if (e.key.toLowerCase() === 'l') game.logout();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="panel">
  <div class="panel-title">НАСТРОЙКИ — ИНТЕРФЕЙС</div>
  <p>
    CRT-ЭФФЕКТЫ: <span class="accent">{game.crt ? 'ВКЛ' : 'ВЫКЛ'}</span>
    <button onclick={() => game.toggleCrt()}>[C] ПЕРЕКЛЮЧИТЬ</button>
  </p>
</div>

<div class="panel" style="margin-top:0.5rem">
  <div class="panel-title">НАСТРОЙКИ — КОННЕКТОР</div>
  {#if connector.isTauri}
    <pre>
ИСТОЧНИК ............. ~/.claude/projects/**/*.jsonl
СОСТОЯНИЕ ............ {connector.status?.running ? 'РАБОТАЕТ' : 'ОСТАНОВЛЕН'}</pre>
    <p class="dim">ЧИТАЮТСЯ ТОЛЬКО ЧИСЛОВЫЕ ПОЛЯ РАСХОДА ТОКЕНОВ; ТЕКСТ СООБЩЕНИЙ НЕ ЧИТАЕТСЯ.</p>
  {:else}
    <pre class="dim">КОННЕКТОР ДОСТУПЕН ТОЛЬКО В ДЕСКТОП-ОБОЛОЧКЕ (npm run tauri dev).</pre>
  {/if}
</div>

<div class="panel" style="margin-top:0.5rem">
  <div class="panel-title">НАСТРОЙКИ — АККАУНТ</div>
  <p>
    <button onclick={() => game.logout()}>[L] СМЕНИТЬ КАПИТАНА</button>
  </p>
</div>
