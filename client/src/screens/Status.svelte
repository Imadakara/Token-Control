<script lang="ts">
  import { connector } from '../lib/connector.svelte';
  import { game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';
  import { fmtOvm } from '../lib/terminal/format';

  /** Выбранная во «Флотилии» сущность, иначе — ведущая. */
  const ship = $derived(game.selectedEntity);

  /**
   * Расстыковка объединена со стыковкой в приказ `interact` (ТЗ v0.02 п. 3.2):
   * сервер сам решает направление по dockedObjectId. Больше не бесплатна и не
   * мгновенна — уходит в очередь, как любой другой приказ.
   */
  function undock() {
    if (!ship) return;
    void game.chooseAction('interact', [ship.id]);
  }

  function onKey(e: KeyboardEvent) {
    if (game.screen !== 'status' || game.keysCaptured) return;
    if (e.key.toLowerCase() === 'u' && ship?.dockedObjectId) undock();
  }

  const L = (label: string, width = 22) => label.padEnd(width, '.').replace(/\.$/, '. ');
</script>

<svelte:window onkeydown={onKey} />

<div class="panel">
  <div class="panel-title">{t('СТАТУС СУЩНОСТИ')}</div>
  {#if ship}
    <pre>
{L(t('НАЗВАНИЕ'))} {ship.name}
{L(t('СЕКТОР'))} {ship.sectorId}
{L(t('КООРДИНАТЫ'))} [{Math.round(ship.x)}; {Math.round(ship.y)}]
{L(t('КОРПУС'))} {ship.hp}/{ship.hpMax}
{L(t('СТЫКОВКА'))} {ship.dockedObjectId ? t('ПРИСТЫКОВАН [U — РАССТЫКОВКА]') : t('СВОБОДНЫЙ ПОЛЁТ')}
</pre>
  {/if}
</div>

<div class="panel" style="margin-top:0.5rem">
  <div class="panel-title">{t('НАКОПИТЕЛЬ ОВМ')}</div>
  <pre>
{L(t('ВХОДЯЩИЙ ПОТОК'))} {fmtOvm(game.ratePerMin)} {t('ОВМ/МИН')}
{L(t('БУФЕР'))} {fmtOvm(game.state?.ovmBuffer ?? 0)} / {fmtOvm(game.config?.ovmBufferCap ?? 0)}
</pre>
</div>

<div class="panel" style="margin-top:0.5rem">
  <div class="panel-title">{t('КОННЕКТОР CLAUDE CODE')}</div>
  {#if connector.status}
    {@const s = connector.status}
    <pre>
{L(t('СТАТУС'))} {s.running ? t('РАБОТАЕТ') : t('ОСТАНОВЛЕН')}
{L(t('АГЕНТ'))} {s.agentDetected ? `${t('АКТИВЕН')} (${s.lastActivitySecs ?? 0}${t('С НАЗАД')})` : t('ТИШИНА')}
{L(t('ЗАПИСЕЙ ЗАСЧИТАНО'))} {s.freshRecords}
{L(t('ОЖИДАЕТ ОТПРАВКИ'))} {fmtOvm(s.outboxOvm)} {t('ОВМ')}
{L(t('ПОСЛЕДНИЙ ПАКЕТ'))} +{fmtOvm(s.lastAccepted)} / -{fmtOvm(s.lastClipped)}
{#if s.lastError}<span class="err">{L(t('ОШИБКА'))} {s.lastError}</span>{/if}</pre>
  {:else if connector.isTauri}
    <pre class="dim">{L(t('СТАТУС'))} {t('ЗАПУСК...')}</pre>
  {:else}
    <pre class="dim">{L(t('СТАТУС'))} {t('НЕДОСТУПЕН В БРАУЗЕРНОЙ ВЕРСИИ')}
{t('ЗАПУСТИТЕ ДЕСКТОП-ОБОЛОЧКУ: npm run tauri dev')}</pre>
  {/if}
</div>
