<script lang="ts">
  import { connector } from '../lib/connector.svelte';
  import { game } from '../lib/game.svelte';
  import { i18n, t } from '../lib/i18n.svelte';

  function onKey(e: KeyboardEvent) {
    if (game.screen !== 'settings') return;
    if (e.key.toLowerCase() === 'c') game.toggleCrt();
    else if (e.key.toLowerCase() === 'e') i18n.toggle();
    else if (e.key.toLowerCase() === 'l') game.logout();
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
