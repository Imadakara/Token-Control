<script lang="ts">
  import { ACTION_TYPES, ENTITY_CLASSES, MODULES, type ActionType, type EntityState } from '@tokencontrol/shared';
  import { api } from '../lib/api';
  import { ACTION_LABELS, entityStatusText, game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';
  import { bar, fmtOvm } from '../lib/terminal/format';
  import { keyOf } from '../lib/terminal/keys';
  import ListPicker from '../lib/terminal/ListPicker.svelte';

  /** Флотилия (ТЗ v0.02 п. 2): сущности и стационарные объекты игрока. */

  let cursor = $state(0);
  let hoverId = $state<string | null>(null);
  let ordering = $state(false);
  let renaming = $state(false);
  let renameValue = $state('');
  let renameInput = $state<HTMLInputElement | null>(null);

  const fleet = $derived(game.entities);

  // Курсор не должен убегать за границы при обновлении состояния по опросу
  $effect(() => {
    if (cursor >= fleet.length) cursor = Math.max(0, fleet.length - 1);
  });

  const atCursor = $derived(fleet[cursor] ?? null);
  /** Наведение мышью приоритетнее курсора — как в карте сектора. */
  const info = $derived(fleet.find((e) => e.id === hoverId) ?? atCursor);

  /** Сущности в тех же координатах образуют группу (ТЗ v0.02 п. 2.1). */
  function groupOf(e: EntityState): EntityState[] {
    return fleet.filter((o) => o.groupKey === e.groupKey);
  }

  function classTitle(e: EntityState): string {
    return ENTITY_CLASSES[e.classId]?.title ?? e.classId;
  }

  function select(i: number) {
    cursor = i;
    game.selectedEntityId = fleet[i]?.id ?? null;
  }

  /** Перестановка приоритета раздачи ОВМ. */
  async function movePriority(dir: 1 | -1) {
    const to = cursor + dir;
    if (!atCursor || to < 0 || to >= fleet.length) return;
    const ids = fleet.map((e) => e.id);
    [ids[cursor], ids[to]] = [ids[to]!, ids[cursor]!];
    try {
      game.state = await api.fleetPriority(ids);
      cursor = to;
    } catch (err) {
      game.say(`${t('ОТКАЗ:')} ${(err as Error).message}`);
    }
  }

  async function commitRename() {
    if (!atCursor) return;
    const name = renameValue.trim();
    renaming = false;
    if (!name || name === atCursor.name) return;
    try {
      game.state = await api.fleetRename(atCursor.id, name);
      game.say('СУЩНОСТЬ ПЕРЕИМЕНОВАНА');
    } catch (err) {
      game.say(`${t('ОТКАЗ:')} ${(err as Error).message}`);
    }
  }

  function startRename() {
    if (!atCursor) return;
    renameValue = atCursor.name;
    renaming = true;
    // Фокус после отрисовки поля: пока он в input, game.keysCaptured true
    queueMicrotask(() => renameInput?.select());
  }

  function onKey(e: KeyboardEvent) {
    if (game.screen !== 'fleet' || game.keysCaptured) return;
    const k = keyOf(e);
    if (k === 'ArrowUp') select(Math.max(0, cursor - 1));
    else if (k === 'ArrowDown') select(Math.min(fleet.length - 1, cursor + 1));
    else if (k === 'Enter') {
      if (atCursor) {
        game.selectedEntityId = atCursor.id;
        ordering = true;
      }
    } else if (k === '+') void movePriority(1);
    else if (k === '-') void movePriority(-1);
    else if (k.toLowerCase() === 'r') {
      startRename();
      e.preventDefault();
    }
  }

  function issue(action: ActionType, group: boolean) {
    ordering = false;
    if (!atCursor) return;
    const ids = group ? groupOf(atCursor).map((e) => e.id) : [atCursor.id];
    void game.chooseAction(action, ids);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="wrap">
  <div class="panel list" onmouseleave={() => (hoverId = null)}>
    <div class="panel-title">{t('ФЛОТИЛИЯ')} ({fleet.length})</div>
    {#if fleet.length === 0}
      <p class="dim">{t('НЕТ СУЩНОСТЕЙ')}</p>
    {/if}
    {#each fleet as e, i (e.id)}
      <div
        class="row selectable"
        class:selected={info?.id === e.id}
        onmouseenter={() => (hoverId = e.id)}
        onclick={() => select(i)}
        ondblclick={() => {
          select(i);
          ordering = true;
        }}
        onkeydown={() => {}}
        role="button"
        tabindex="-1"
      >
        <pre>{String(i + 1).padStart(2)}. {e.name.padEnd(12)} {classTitle(e).padEnd(20)} {entityStatusText(e).padEnd(24)} [{Math.round(e.x)}; {Math.round(e.y)}]</pre>
      </div>
    {/each}
    <p class="dim">{t('[↑↓] ВЫБОР [ENTER] ПРИКАЗ [R] ПЕРЕИМЕНОВАТЬ [+/-] ПРИОРИТЕТ ОВМ')}</p>
  </div>

  <div class="panel info">
    <div class="panel-title">{t('ИНФОРМАЦИЯ О СУЩНОСТИ')}</div>
    {#if info}
      {#if renaming && atCursor && info.id === atCursor.id}
        <!-- Текстовое поле: пока в нём фокус, App не перехватывает цифры -->
        <div class="rename">
          <span>{t('НОВОЕ ИМЯ:')}</span>
          <input
            bind:this={renameInput}
            bind:value={renameValue}
            maxlength="32"
            onkeydown={(e) => {
              if (e.key === 'Enter') void commitRename();
              else if (e.key === 'Escape') renaming = false;
            }}
          />
        </div>
      {/if}
      <pre>
{t('НАЗВАНИЕ').padEnd(18, '.')} {info.name}
{t('КЛАСС').padEnd(18, '.')} {classTitle(info)}
{t('СТАТУС').padEnd(18, '.')} {entityStatusText(info)}
{t('СЕКТОР').padEnd(18, '.')} {info.sectorId}
{t('КООРДИНАТЫ').padEnd(18, '.')} [{Math.round(info.x)}; {Math.round(info.y)}]
{t('ПРИОРИТЕТ ОВМ').padEnd(18, '.')} {info.priority}
{t('КОРПУС').padEnd(18, '.')} {info.hp}/{info.hpMax}
{t('ТРЮМ').padEnd(18, '.')} {info.cargoUsed}/{info.cargoCapacity}</pre>

      <pre>{t('МОДУЛИ').padEnd(18, '.')} {info.modules.length
          ? info.modules.map((m) => t(MODULES[m]?.title ?? m)).join(', ')
          : t('НЕТ')}</pre>

      {#if groupOf(info).length > 1}
        <pre class="accent">{t('В ГРУППЕ').padEnd(18, '.')} {groupOf(info).length} {t('СУЩНОСТЕЙ В ЭТИХ КООРДИНАТАХ')}</pre>
      {/if}

      <div class="orders">
        <div class="panel-title">{t('ПРИКАЗЫ')}</div>
        {#if info.orders.length === 0}
          <p class="dim">{t('ПРИКАЗОВ НЕТ')}</p>
        {:else}
          {#each info.orders as o (o.slot)}
            <div>
              <span class="accent">{o.slot}.</span>
              {t(ACTION_LABELS[o.action])}
              <span class={o.status === 'active' ? 'accent' : 'dim'}>
                [{o.status === 'active' ? t('ВЫПОЛНЯЕТСЯ') : t('ОЖИДАНИЕ')}]
              </span>
              <pre>{bar(o.progressOvm, o.costOvm, 24)} {fmtOvm(Math.min(o.progressOvm, o.costOvm))}/{fmtOvm(o.costOvm)} {t('ОВМ')}</pre>
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <p class="dim">{t('НАВЕДИТЕ КУРСОР НА СУЩНОСТЬ В СПИСКЕ')}</p>
    {/if}
  </div>
</div>

{#if ordering && atCursor}
  {@const group = groupOf(atCursor)}
  <ListPicker
    title={group.length > 1
      ? `${t('ПРИКАЗ ГРУППЕ')}: ${group.length} ${t('СУЩН.')} В [${Math.round(atCursor.x)}; ${Math.round(atCursor.y)}]`
      : `${t('ПРИКАЗ')}: ${atCursor.name}`}
    items={ACTION_TYPES}
    label={(a) => t(ACTION_LABELS[a])}
    note={(a) => `(${game.config?.actionCosts[a] ?? '?'} ${t('ОВМ')})`}
    onpick={(a) => issue(a, group.length > 1)}
    oncancel={() => (ordering = false)}
  />
{/if}

<style>
  .wrap {
    display: flex;
    gap: 0.75rem;
    align-items: stretch;
    height: 100%;
  }
  .list {
    flex: 1;
    overflow-y: auto;
  }
  .row {
    padding: 0.1rem 0.3rem;
  }
  .info {
    min-width: 28rem;
    overflow-y: auto;
  }
  .rename {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.4rem;
  }
  .rename input {
    flex: 1;
  }
  .orders {
    margin-top: 0.75rem;
    border-top: 1px solid var(--term-dim);
    padding-top: 0.4rem;
  }
</style>
