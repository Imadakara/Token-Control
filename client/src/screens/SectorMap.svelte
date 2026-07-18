<script lang="ts">
  import type { SectorObject } from '@tokencontrol/shared';
  import { game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';
  import { keyOf } from '../lib/terminal/keys';

  // Символьная карта: координаты сектора [-1000,1000] → сетка COLS×ROWS
  const COLS = 61;
  const ROWS = 21;
  const RANGE = 1000;

  let cx = $state(Math.floor(COLS / 2));
  let cy = $state(Math.floor(ROWS / 2));
  let objIndex = $state(-1); // выбранный объект (Tab)
  let hoverId = $state<string | null>(null); // наведение в списке объектов

  const objects = $derived(game.sector?.objects ?? []);
  const ship = $derived(game.state?.ship ?? null);

  function toCell(x: number, y: number): [number, number] {
    const col = Math.round(((x + RANGE) / (2 * RANGE)) * (COLS - 1));
    const row = Math.round(((y + RANGE) / (2 * RANGE)) * (ROWS - 1));
    return [Math.max(0, Math.min(COLS - 1, col)), Math.max(0, Math.min(ROWS - 1, row))];
  }

  function toCoords(col: number, row: number): [number, number] {
    return [
      Math.round((col / (COLS - 1)) * 2 * RANGE - RANGE),
      Math.round((row / (ROWS - 1)) * 2 * RANGE - RANGE),
    ];
  }

  const SYMBOLS: Record<SectorObject['type'], string> = {
    station: 'S',
    asteroid: '*',
    container: 'c',
    phenomenon: '~',
  };

  const grid = $derived.by(() => {
    const rows: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill('·'));
    for (const o of objects) {
      const [col, row] = toCell(o.x, o.y);
      rows[row]![col] = SYMBOLS[o.type];
    }
    if (ship) {
      const [col, row] = toCell(ship.x, ship.y);
      rows[row]![col] = '@';
    }
    return rows;
  });

  const objectAtCursor = $derived(
    objects.find((o) => {
      const [col, row] = toCell(o.x, o.y);
      return col === cx && row === cy;
    }) ?? null,
  );

  /** Объект для инфо-панели: наведение приоритетнее курсора карты. */
  const infoObject = $derived(objects.find((o) => o.id === hoverId) ?? objectAtCursor);

  function cycleObject(dir: 1 | -1) {
    if (objects.length === 0) return;
    objIndex = (objIndex + dir + objects.length) % objects.length;
    const o = objects[objIndex]!;
    [cx, cy] = toCell(o.x, o.y);
  }

  function onMapClick(e: MouseEvent) {
    const cell = (e.target as HTMLElement).dataset;
    if (cell.c !== undefined && cell.r !== undefined) {
      cx = Number(cell.c);
      cy = Number(cell.r);
    }
  }

  function confirm() {
    const pick = game.pick;
    if (!pick) return;
    if (pick.target === 'object') {
      if (!objectAtCursor) {
        game.say('ЗДЕСЬ НЕТ ОБЪЕКТА — [TAB] ПЕРЕБОР ЦЕЛЕЙ');
        return;
      }
      void game.enqueue(pick.action, { kind: 'object', objectId: objectAtCursor.id });
      game.screen = 'queue';
    } else if (pick.target === 'point') {
      if (objectAtCursor) {
        void game.enqueue(pick.action, { kind: 'object', objectId: objectAtCursor.id });
      } else {
        const [x, y] = toCoords(cx, cy);
        void game.enqueue(pick.action, { kind: 'point', x, y });
      }
      game.screen = 'queue';
    }
  }

  function onKey(e: KeyboardEvent) {
    if (game.screen !== 'sector') return;
    const k = keyOf(e);
    if (k === 'ArrowLeft') cx = Math.max(0, cx - 1);
    else if (k === 'ArrowRight') cx = Math.min(COLS - 1, cx + 1);
    else if (k === 'ArrowUp') cy = Math.max(0, cy - 1);
    else if (k === 'ArrowDown') cy = Math.min(ROWS - 1, cy + 1);
    else if (k === 'Tab') {
      cycleObject(e.shiftKey ? -1 : 1);
      e.preventDefault();
    } else if (k === 'Enter') confirm();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="wrap">
  <div class="panel">
    <div class="panel-title">
      {t('КАРТА СЕКТОРА')} {game.sector?.sectorId ?? '—'}
      {#if game.pick}<span class="err">{t('— РЕЖИМ ВЫБОРА ЦЕЛИ')}</span>{/if}
    </div>
    <!-- Один делегированный обработчик на всю карту: клик = позиция курсора -->
    <pre
      class="map"
      role="button"
      tabindex="-1"
      onclick={onMapClick}
      ondblclick={confirm}
      onkeydown={() => {}}>{#each grid as row, ri (ri)}{#each row as ch, ci (ci)}<span
            class:cursor={ci === cx && ri === cy}
            class:obj={ch !== '·'}
            data-c={ci}
            data-r={ri}>{ch}</span>{/each}{'\n'}{/each}</pre>
    <p class="dim">
      {t('@ КОРАБЛЬ')} &nbsp; {t('S СТАНЦИЯ')} &nbsp; {t('* АСТЕРОИД')} &nbsp;
      {t('c КОНТЕЙНЕР')} &nbsp; {t('~ ФЕНОМЕН')}
    </p>
  </div>

  <div class="right">
    <div class="panel side" onmouseleave={() => (hoverId = null)}>
      <div class="panel-title">{t('ОБЪЕКТЫ')} ({objects.length})</div>
      {#if objects.length === 0}
        <p class="dim">{t('НЕТ ДАННЫХ — ВЫПОЛНИТЕ СКАНИРОВАНИЕ')}</p>
      {/if}
      {#each objects as o, i (o.id)}
        <div
          class="selectable"
          class:selected={infoObject?.id === o.id}
          onmouseenter={() => (hoverId = o.id)}
          onclick={() => {
            objIndex = i;
            const [col, row] = toCell(o.x, o.y);
            cx = col;
            cy = row;
          }}
          onkeydown={() => {}}
          role="button"
          tabindex="-1"
        >
          {SYMBOLS[o.type]}
          {o.type.toUpperCase()}
          <span class="dim">[{o.x}; {o.y}]</span>
          {#if o.props}<span class="accent">{t('✓АНАЛИЗ')}</span>{/if}
        </div>
      {/each}
    </div>

    <div class="panel info">
      <div class="panel-title">{t('ИНФОРМАЦИЯ ОБ ОБЪЕКТЕ')}</div>
      {#if infoObject}
        <pre>
{t('ТИП')} ............. {SYMBOLS[infoObject.type]} {infoObject.type.toUpperCase()}
{t('КООРДИНАТЫ')} ...... [{infoObject.x}; {infoObject.y}]
{t('СТАТУС')} .......... {infoObject.props ? t('ПРОАНАЛИЗИРОВАН') : t('ПРОСКАНИРОВАН')}</pre>
        {#if infoObject.props}
          {#each Object.entries(infoObject.props) as [key, value] (key)}
            <pre>{key.toUpperCase().padEnd(18, '.')} {String(value).toUpperCase()}</pre>
          {/each}
          {#if infoObject.resourceAmount !== null}
            <pre>{t('ЗАПАС').padEnd(18, '.')} {infoObject.resourceAmount}</pre>
          {/if}
        {:else}
          <p class="dim">{t('ДАННЫЕ ОГРАНИЧЕНЫ — ТРЕБУЕТСЯ АНАЛИЗ ОБЪЕКТА')}</p>
        {/if}
      {:else}
        <p class="dim">{t('НАВЕДИТЕ КУРСОР НА ОБЪЕКТ В СПИСКЕ ИЛИ НА КАРТЕ')}</p>
      {/if}
    </div>
  </div>
</div>

<p class="dim">
  {t('[←↑↓→] КУРСОР [TAB] ЦЕЛИ [ENTER] ВЫБОР')}{game.pick ? ` ${t('[ESC] ОТМЕНА')}` : ''}
</p>

<style>
  .wrap {
    display: flex;
    gap: 0.75rem;
    align-items: stretch; /* правая колонка тянется до низа панели карты */
  }
  .right {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 24rem;
  }
  .info {
    flex: 1;
    overflow-y: auto;
  }
  .map {
    line-height: 1.1;
    letter-spacing: 0.35em;
    user-select: none;
  }
  .map .obj {
    color: var(--term-accent);
  }
  .map .cursor {
    background: var(--term-fg);
    color: var(--term-bg);
  }
  .side {
    max-height: 45vh;
    overflow-y: auto;
  }
</style>
