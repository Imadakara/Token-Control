<script lang="ts">
  import type { SectorObject } from '@tokencontrol/shared';
  import { game } from '../lib/game.svelte';
  import { keyOf } from '../lib/terminal/keys';

  // Символьная карта: координаты сектора [-1000,1000] → сетка COLS×ROWS
  const COLS = 61;
  const ROWS = 21;
  const RANGE = 1000;

  let cx = $state(Math.floor(COLS / 2));
  let cy = $state(Math.floor(ROWS / 2));
  let objIndex = $state(-1); // выбранный объект (Tab)

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
      КАРТА СЕКТОРА {game.sector?.sectorId ?? '—'}
      {#if game.pick}<span class="err">— РЕЖИМ ВЫБОРА ЦЕЛИ</span>{/if}
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
    <p class="dim">@ КОРАБЛЬ &nbsp; S СТАНЦИЯ &nbsp; * АСТЕРОИД &nbsp; c КОНТЕЙНЕР &nbsp; ~ ФЕНОМЕН</p>
  </div>

  <div class="panel side">
    <div class="panel-title">ОБЪЕКТЫ ({objects.length})</div>
    {#if objects.length === 0}
      <p class="dim">НЕТ ДАННЫХ — ВЫПОЛНИТЕ СКАНИРОВАНИЕ</p>
    {/if}
    {#each objects as o, i (o.id)}
      <div
        class="selectable"
        class:selected={objectAtCursor?.id === o.id}
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
        {#if o.props}<span class="accent">✓АНАЛИЗ</span>{/if}
        {#if o.resourceAmount !== null}<span class="dim">ЗАПАС:{o.resourceAmount}</span>{/if}
      </div>
    {/each}
    {#if objectAtCursor?.props}
      <div class="panel-title" style="margin-top:0.5rem">СВОЙСТВА ЦЕЛИ</div>
      <pre class="dim">{JSON.stringify(objectAtCursor.props, null, 1)}</pre>
    {/if}
  </div>
</div>

<p class="dim">[←↑↓→] КУРСОР [TAB] ЦЕЛИ [ENTER] ВЫБОР{game.pick ? ' [ESC] ОТМЕНА' : ''}</p>

<style>
  .wrap {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
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
    min-width: 22rem;
    max-height: 60vh;
    overflow-y: auto;
  }
</style>
