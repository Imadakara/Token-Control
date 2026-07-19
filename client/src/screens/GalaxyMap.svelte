<script lang="ts">
  import { untrack } from 'svelte';
  import type { ChainKeyInfo } from '@tokencontrol/shared';
  import { api } from '../lib/api';
  import { game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';
  import { keyOf } from '../lib/terminal/keys';

  /**
   * Цепь Миров (ТЗ v0.02 п. 4): рёбра chainLinks видны всем (топология —
   * не тайна, скрыто лишь содержимое секторов), reachable — куда прямо сейчас
   * возможен гиперпрыжок с текущей позиции (см. routes/map.ts). Ключи —
   * заглушка монетизации, применяются к домашнему сектору игрока.
   */

  const width = $derived(game.galaxy?.galaxyWidth ?? 10);
  const height = $derived(game.galaxy?.galaxyHeight ?? 10);
  const visited = $derived(new Set((game.galaxy?.sectors ?? []).map((s) => s.id)));
  const current = $derived(game.galaxy?.currentSectorId ?? '');
  const reachable = $derived(new Set(game.galaxy?.reachable ?? []));
  const linkedToCurrent = $derived(
    new Set(
      (game.galaxy?.chainLinks ?? [])
        .filter((l) => l.a === current || l.b === current)
        .map((l) => (l.a === current ? l.b : l.a)),
    ),
  );

  let cx = $state(5);
  let cy = $state(5);

  let keys = $state<ChainKeyInfo[]>([]);

  async function loadKeys() {
    keys = (await api.chain()).keys;
  }

  $effect(() => {
    if (game.screen !== 'galaxy') return;
    void loadKeys();
  });

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

  function cellGlyph(gx: number, gy: number): string {
    const id = cellId(gx, gy);
    if (id === current) return '▣';
    if (linkedToCurrent.has(id)) return '◆';
    if (visited.has(id)) return '▪';
    return '·';
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

  async function applyKey(keyId: string) {
    try {
      game.state = await api.chainConnect(keyId);
      game.say(t('КЛЮЧ ПРИМЕНЁН — ДОМАШНИЙ СЕКТОР ПОДКЛЮЧЁН К ЦЕПИ'));
      await loadKeys();
    } catch (err) {
      game.say(`${t('ОТКАЗ:')} ${(err as Error).message}`);
    }
  }

  async function debugGetKey() {
    try {
      await api.debugChainKey();
      game.say(t('ДЕБАГ: КЛЮЧ ВЫДАН'));
      await loadKeys();
    } catch (err) {
      game.say(`${t('ОТКАЗ:')} ${(err as Error).message}`);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="wrap">
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
            class:link={linkedToCurrent.has(cellId(gx, gy))}
            class:reach={reachable.has(cellId(gx, gy))}
            class:vis={visited.has(cellId(gx, gy))}
            data-c={gx}
            data-r={gy}>{cellGlyph(gx, gy)}</span
          >{/each}{'\n'}{/each}</pre>
    <p class="dim">
      {t('▣ ТЕКУЩИЙ')} &nbsp; {t('◆ СВЯЗАН ЦЕПЬЮ')} &nbsp; {t('▪ ПОСЕЩЁН')} &nbsp;
      {t('· НЕИЗВЕСТЕН')} &nbsp; {t('КУРСОР:')} {cellId(cx, cy)}
    </p>
    <p class="dim">
      {t(
        'ГИПЕРПРЫЖОК ТОЛЬКО ПО РЁБРАМ ЦЕПИ МИРОВ — ТРЕБУЕТСЯ ТЕХНОЛОГИЯ И СВОИ ВРАТА В СЕКТОРЕ',
      )}
    </p>
  </div>

  <div class="panel keys">
    <div class="panel-title">{t('КЛЮЧИ ЦЕПИ МИРОВ')}</div>
    {#if keys.length === 0}
      <p class="dim">{t('КЛЮЧЕЙ НЕТ')}</p>
    {:else}
      <ul>
        {#each keys as key (key.id)}
          <li>
            <span class:dim={!!key.consumedAt}>
              {key.targetSectorId ? `→ ${key.targetSectorId}` : t('СЛУЧАЙНАЯ ЦЕЛЬ')}
              {key.consumedAt ? `(${t('ИСПОЛЬЗОВАН')})` : ''}
            </span>
            {#if !key.consumedAt}
              <button onclick={() => void applyKey(key.id)}>{t('ПРИМЕНИТЬ')}</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if game.debugMode}
      <button class="debug" onclick={() => void debugGetKey()}>{t('ДЕБАГ: ПОЛУЧИТЬ КЛЮЧ')}</button>
    {/if}
  </div>
</div>

<p class="dim">{t('[←↑↓→] КУРСОР [ENTER] ВЫБОР')}{game.pick ? ` ${t('[ESC] ОТМЕНА')}` : ''}</p>

<style>
  .wrap {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
  }
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
  .map .link {
    color: var(--term-accent);
  }
  .map .reach {
    color: var(--term-accent);
    font-weight: bold;
  }
  .map .cursor {
    background: var(--term-fg);
    color: var(--term-bg);
  }
  .keys {
    min-width: 20rem;
  }
  .keys ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .keys li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem 0;
  }
  .debug {
    margin-top: 0.5rem;
  }
</style>
