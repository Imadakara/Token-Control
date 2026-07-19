<script lang="ts">
  import { untrack } from 'svelte';
  import { game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';
  import { keyOf } from '../lib/terminal/keys';

  const width = $derived(game.galaxy?.galaxyWidth ?? 10);
  const height = $derived(game.galaxy?.galaxyHeight ?? 10);
  const visited = $derived(new Set((game.galaxy?.sectors ?? []).map((s) => s.id)));
  const current = $derived(game.galaxy?.currentSectorId ?? '');

  let cx = $state(5);
  let cy = $state(5);

  $effect(() => {
    // Курсор сбрасывается на текущий сектор ТОЛЬКО при открытии экрана.
    // Зависимость эффекта — game.screen; чтение galaxy обёрнуто в untrack,
    // иначе каждый фоновый рефреш карты возвращал курсор на место.
    if (game.screen !== 'galaxy') return;
    untrack(() => {
      const cur = game.galaxy?.currentSectorId;
      if (cur) {
        const [gx, gy] = cur.split(':').map(Number);
        cx = gx!;
        cy = gy!;
      }
    });
  });

  function cellId(gx: number, gy: number) {
    return `${gx}:${gy}`;
  }

  function onMapClick(e: MouseEvent) {
    const cell = (e.target as HTMLElement).dataset;
    if (cell.c !== undefined && cell.r !== undefined) {
      cx = Number(cell.c);
      cy = Number(cell.r);
    }
  }

  function confirm() {
    if (game.pick?.target === 'sector') {
      void game.enqueue(game.pick.action, { kind: 'sector', sectorId: cellId(cx, cy) });
      game.screen = 'orders';
    }
  }

  function onKey(e: KeyboardEvent) {
    if (game.screen !== 'galaxy' || game.keysCaptured) return;
    const k = keyOf(e);
    if (k === 'ArrowLeft') cx = Math.max(0, cx - 1);
    else if (k === 'ArrowRight') cx = Math.min(width - 1, cx + 1);
    else if (k === 'ArrowUp') cy = Math.max(0, cy - 1);
    else if (k === 'ArrowDown') cy = Math.min(height - 1, cy + 1);
    else if (k === 'Enter') confirm();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="panel">
  <div class="panel-title">
    {t('КАРТА ГАЛАКТИКИ — СЕКТОР')} {current}
    {#if game.pick}<span class="err">{t('— ВЫБОР ЦЕЛИ ГИПЕРПРЫЖКА')}</span>{/if}
  </div>
  <pre
    class="map"
    role="button"
    tabindex="-1"
    onclick={onMapClick}
    ondblclick={confirm}
    onkeydown={() => {}}>{#each Array.from({ length: height }, (_, gy) => gy) as gy (gy)}{#each Array.from({ length: width }, (_, gx) => gx) as gx (gx)}<span
          class:cursor={gx === cx && gy === cy}
          class:cur={cellId(gx, gy) === current}
          class:vis={visited.has(cellId(gx, gy))}
          data-c={gx}
          data-r={gy}>{cellId(gx, gy) === current ? '▣' : visited.has(cellId(gx, gy)) ? '▪' : '·'}</span
        >{/each}{'\n'}{/each}</pre>
  <p class="dim">
    {t('▣ ТЕКУЩИЙ')} &nbsp; {t('▪ ПОСЕЩЁН')} &nbsp; {t('· НЕИЗВЕСТЕН')} &nbsp;
    {t('КУРСОР:')} {cellId(cx, cy)}
  </p>
  <p class="dim">{t('ГИПЕРПРЫЖОК В MVP — ТОЛЬКО В СОСЕДНИЕ СЕКТОРА')}</p>
</div>

<p class="dim">{t('[←↑↓→] КУРСОР [ENTER] ВЫБОР')}{game.pick ? ` ${t('[ESC] ОТМЕНА')}` : ''}</p>

<style>
  .map {
    line-height: 1.4;
    letter-spacing: 0.8em;
    user-select: none;
  }
  .map .vis {
    color: var(--term-fg);
  }
  .map .cur {
    color: var(--term-accent);
  }
  .map .cursor {
    background: var(--term-fg);
    color: var(--term-bg);
  }
</style>
