<script lang="ts">
  import { api } from '../lib/api';
  import {
    assistantSettings,
    checkConnection,
    ollamaAutoStatus,
    pullModel,
    refreshModelAvailability,
  } from '../lib/assistant.svelte';
  import { connector } from '../lib/connector.svelte';
  import { game } from '../lib/game.svelte';
  import { i18n, t } from '../lib/i18n.svelte';
  import Confirm from '../lib/terminal/Confirm.svelte';

  let debugBusy = $state(false);
  let connChecking = $state(false);
  let connOk = $state<boolean | null>(null);
  let pendingDownload = $state(false);
  let downloading = $state(false);
  let downloadProgress = $state<{ status: string; percent: number | null } | null>(null);
  let downloadError = $state<string | null>(null);

  // Свежая проверка при каждом открытии экрана — кэш из ensureOllamaRunning
  // (один раз при входе в игру) мог устареть или быть неверным.
  $effect(() => {
    if (game.screen !== 'settings') return;
    void refreshModelAvailability();
  });

  async function testConnection() {
    connChecking = true;
    connOk = await checkConnection();
    void refreshModelAvailability();
    connChecking = false;
  }

  /** Проверяем ещё раз прямо перед диалогом — модель могла появиться уже после
   *  открытия экрана (например, sidecar только что доставил её). */
  async function onDownloadClick() {
    if (downloading) return;
    const available = await refreshModelAvailability();
    if (available !== true) pendingDownload = true;
  }

  async function confirmDownload() {
    pendingDownload = false;
    downloading = true;
    downloadError = null;
    downloadProgress = { status: '', percent: null };
    try {
      await pullModel(assistantSettings.model, (p) => (downloadProgress = p));
      ollamaAutoStatus.modelAvailable = true;
    } catch (err) {
      downloadError = (err as Error).message;
    }
    downloading = false;
    downloadProgress = null;
  }

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
    if (game.screen !== 'settings' || game.keysCaptured) return;
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
  <div class="panel-title">{t('НАСТРОЙКИ — АССИСТЕНТ')}</div>
  <p>
    {t('АДРЕС API:')}
    <input
      value={assistantSettings.baseUrl}
      oninput={(e) => assistantSettings.setBaseUrl(e.currentTarget.value)}
    />
  </p>
  <p>
    {t('МОДЕЛЬ:')}
    <input
      value={assistantSettings.model}
      oninput={(e) => assistantSettings.setModel(e.currentTarget.value)}
    />
  </p>
  <p>
    <button onclick={testConnection} disabled={connChecking}>{t('ПРОВЕРИТЬ')}</button>
    {#if connChecking}
      <span class="dim">{t('ПРОВЕРКА...')}</span>
    {:else if connOk === true}
      <span class="accent">{t('ПОДКЛЮЧЕНО')}</span>
    {:else if connOk === false}
      <span class="err">{t('НЕДОСТУПНО')}</span>
    {/if}
  </p>
  {#if ollamaAutoStatus.modelAvailable === false || downloading}
    <p>
      <button onclick={() => void onDownloadClick()} disabled={downloading}>
        {t('СКАЧАТЬ МОДЕЛЬ')}
      </button>
      {#if downloading}
        <span class="dim">
          {t('ЗАГРУЗКА МОДЕЛИ')}{downloadProgress?.percent !== null && downloadProgress?.percent !== undefined
            ? `: ${downloadProgress.percent}%`
            : '...'}
        </span>
      {/if}
    </p>
    {#if downloadError}
      <p class="err">{t('ОШИБКА ЗАГРУЗКИ:')} {downloadError}</p>
    {/if}
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

{#if pendingDownload}
  <Confirm
    message={`${t('СКАЧАТЬ МОДЕЛЬ АССИСТЕНТА')} (${assistantSettings.model}, ~2 ${t('ГБ')})? ${t('ПОНАДОБИТСЯ ОДИН РАЗ.')}`}
    onconfirm={() => void confirmDownload()}
    oncancel={() => (pendingDownload = false)}
  />
{/if}

<style>
  .debug {
    border-color: var(--term-accent);
  }
</style>
