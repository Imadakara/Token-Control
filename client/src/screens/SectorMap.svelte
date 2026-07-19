<script lang="ts">
  import { ACTION_TYPES, type SectorObject } from '@tokencontrol/shared';
  import { ACTION_LABELS, entityStatusText, game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';
  import { keyOf } from '../lib/terminal/keys';
  import ListPicker from '../lib/terminal/ListPicker.svelte';

  // Символьная карта: координаты сектора [-1000,1000] → сетка COLS×ROWS
  const COLS = 61;
  const ROWS = 21;
  const RANGE = 1000;

  let cx = $state(Math.floor(COLS / 2));
  let cy = $state(Math.floor(ROWS / 2));
  let objIndex = $state(-1); // выбранный объект (Tab)
  let hoverId = $state<string | null>(null); // наведение в списке объектов
  let ordering = $state(false); // окно выбора приказа для сущностей в клетке

  const objects = $derived(game.sector?.objects ?? []);
  /** Сущности флота в этом секторе (ТЗ v0.02 п. 2.1). */
  const fleetHere = $derived(
    game.entities.filter((e) => e.sectorId === game.sector?.sectorId),
  );

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
    // Сущности рисуются последними — флот важнее фона
    for (const e of fleetHere) {
      const [col, row] = toCell(e.x, e.y);
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

  /** Свои сущности в клетке под курсором — они же группа для приказа. */
  const fleetAtCursor = $derived(
    fleetHere.filter((e) => {
      const [col, row] = toCell(e.x, e.y);
      return col === cx && row === cy;
    }),
  );

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
      game.screen = 'orders';
    } else if (pick.target === 'point') {
      if (objectAtCursor) {
        void game.enqueue(pick.action, { kind: 'object', objectId: objectAtCursor.id });
      } else {
        const [x, y] = toCoords(cx, cy);
        void game.enqueue(pick.action, { kind: 'point', x, y });
      }
      game.screen = 'orders';
    }
  }

  function onKey(e: KeyboardEvent) {
    if (game.screen !== 'sector' || game.keysCaptured) return;
    const k = keyOf(e);
    if (k === 'ArrowLeft') cx = Math.max(0, cx - 1);
    else if (k === 'ArrowRight') cx = Math.min(COLS - 1, cx + 1);
    else if (k === 'ArrowUp') cy = Math.max(0, cy - 1);
    else if (k === 'ArrowDown') cy = Math.min(ROWS - 1, cy + 1);
    else if (k === 'Tab') {
      cycleObject(e.shiftKey ? -1 : 1);
      e.preventDefault();
    } else if (k === 'Enter') {
      // В режиме выбора цели Enter подтверждает цель, иначе — приказ своим
      if (game.pick) confirm();
      else if (fleetAtCursor.length > 0) ordering = true;
    }
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
      {t('@ СВОЯ СУЩНОСТЬ')} &nbsp; {t('S СТАНЦИЯ')} &nbsp; {t('* АСТЕРОИД')} &nbsp;
      {t('c КОНТЕЙНЕР')} &nbsp; {t('~ ФЕНОМЕН')}
    </p>
  </div>

  <div class="right">
    <div class="panel side" onmouseleave={() => (hoverId = null)}>
      <div class="panel-title">{t('СВОИ СУЩНОСТИ')} ({fleetHere.length})</div>
      {#each fleetHere as e (e.id)}
        <div
          class="selectable"
          onclick={() => {
            [cx, cy] = toCell(e.x, e.y);
            game.selectedEntityId = e.id;
          }}
          ondblclick={() => {
            [cx, cy] = toCell(e.x, e.y);
            ordering = true;
          }}
          onkeydown={() => {}}
          role="button"
          tabindex="-1"
        >
          @ <span class="accent">{e.name}</span>
          <span class="dim">[{Math.round(e.x)}; {Math.round(e.y)}]</span>
        </div>
      {/each}

      <div class="panel-title objects-title">{t('ОБЪЕКТЫ')} ({objects.length})</div>
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
      {#if fleetAtCursor.length > 0}
        <!-- Состояние сущности видно и здесь, не только во «Флотилии» (ТЗ v0.02 п. 2.1) -->
        <div class="panel-title">{t('СУЩНОСТИ В ЭТИХ КООРДИНАТАХ')} ({fleetAtCursor.length})</div>
        {#each fleetAtCursor as e (e.id)}
          <pre>{e.name.padEnd(12)} {entityStatusText(e).padEnd(24)} {t('ТРЮМ')} {e.cargoUsed}/{e.cargoCapacity}</pre>
        {/each}
        <p class="dim">{t('[ENTER] ПРИКАЗ ЭТИМ СУЩНОСТЯМ')}</p>
      {/if}

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

{#if ordering && fleetAtCursor.length > 0}
  <ListPicker
    title={fleetAtCursor.length > 1
      ? `${t('ПРИКАЗ ГРУППЕ')}: ${fleetAtCursor.length} ${t('СУЩН.')}`
      : `${t('ПРИКАЗ')}: ${fleetAtCursor[0]!.name}`}
    items={ACTION_TYPES}
    label={(a) => t(ACTION_LABELS[a])}
    note={(a) => `(${game.config?.actionCosts[a] ?? '?'} ${t('ОВМ')})`}
    onpick={(a) => {
      ordering = false;
      void game.chooseAction(
        a,
        fleetAtCursor.map((e) => e.id),
      );
    }}
    oncancel={() => (ordering = false)}
  />
{/if}

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
  .objects-title {
    margin-top: 0.6rem;
  }
</style>
