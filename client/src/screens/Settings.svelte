<script lang="ts">
  import { api } from '../lib/api';
  import { connector } from '../lib/connector.svelte';
  import { game } from '../lib/game.svelte';
  import { i18n, t } from '../lib/i18n.svelte';

  let debugBusy = $state(false);

  async function debugCredit() {
    if (debugBusy) return;
    debugBusy = true;
    try {
      game.state = await api.debugCredit(1000);
      game.say('ДЕБАГ: +1000 ОВМ В БУФЕР');
    } catch (err) {
      game.say(`${t('ОТКАЗ:')} ${(err as Error).message}`);
    }
    debugBusy = false;
  }

  function onKey(e: KeyboardEvent) {
    if (game.screen !== 'settings') return;
    if (e.key.toLowerCase() === 'c') game.toggleCrt();
    else if (e.key.toLowerCase() === 'e') i18n.toggle();
    else if (e.key.toLowerCase() === 'l') game.logout();
    else if (e.key.toLowerCase() === 'b' && game.debugMode) void debugCredit();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="panel">
  <div class="panel-title">{t('НАСТРОЙКИ — ИНТЕРФЕЙС')}</div>
  <p>
    {t('CRT-ЭФФЕКТЫ:')} <span class="accent">{game.crt ? t('ВКЛ') : t('ВЫКЛ')}</span>
    <button onclick={() => game.toggleCrt()}>{t('[C] ПЕРЕКЛЮЧИТЬ')}</button>
  </p>
  <p>
    {t('ЯЗЫК:')} <span class="accent">{i18n.lang === 'ru' ? 'РУССКИЙ' : 'ENGLISH'}</span>
    <button onclick={() => i18n.toggle()}>{t('[E] ПЕРЕКЛЮЧИТЬ')}</button>
  </p>
</div>

<div class="panel" style="margin-top:0.5rem">
  <div class="panel-title">{t('НАСТРОЙКИ — КОННЕКТОР')}</div>
  {#if connector.isTauri}
    <pre>
{t('ИСТОЧНИК')} ............. ~/.claude/projects/**/*.jsonl
{t('СОСТОЯНИЕ')} ............ {connector.status?.running ? t('РАБОТАЕТ') : t('ОСТАНОВЛЕН')}</pre>
    <p class="dim">{t('ЧИТАЮТСЯ ТОЛЬКО ЧИСЛОВЫЕ ПОЛЯ РАСХОДА ТОКЕНОВ; ТЕКСТ СООБЩЕНИЙ НЕ ЧИТАЕТСЯ.')}</p>
  {:else}
    <pre class="dim">{t('КОННЕКТОР ДОСТУПЕН ТОЛЬКО В ДЕСКТОП-ОБОЛОЧКЕ (npm run tauri dev).')}</pre>
  {/if}
</div>

<div class="panel" style="margin-top:0.5rem">
  <div class="panel-title">{t('НАСТРОЙКИ — АККАУНТ')}</div>
  <p>
    <button onclick={() => game.logout()}>{t('[L] СМЕНИТЬ КАПИТАНА')}</button>
  </p>
</div>

{#if game.debugMode}
  <div class="panel debug" style="margin-top:0.5rem">
    <div class="panel-title">{t('НАСТРОЙКИ — ОТЛАДКА')}</div>
    <p class="dim">{t('РЕЖИМ ОТЛАДКИ АКТИВЕН (ПОЗЫВНОЙ DEBUG)')}</p>
    <p>
      <button onclick={debugCredit} disabled={debugBusy}>{t('[B] +1000 ОВМ В БУФЕР')}</button>
    </p>
  </div>
{/if}

<style>
  .debug {
    border-color: var(--term-accent);
  }
</style>
