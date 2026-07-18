<script lang="ts">
  import { ACTION_TYPES, type ActionType } from '@tokencontrol/shared';
  import { api } from '../lib/api';
  import { ACTION_LABELS, game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';
  import { bar, fmtOvm } from '../lib/terminal/format';
  import { keyOf } from '../lib/terminal/keys';

  let cursor = $state(0); // выбранный слот (0-based)
  let adding = $state(false);
  let addCursor = $state(0);
  let confirmSlot = $state<1 | 2 | 3 | null>(null);
  let now = $state(Date.now());

  const queue = $derived(game.state?.queue ?? []);

  function slotAt(i: number) {
    return queue.find((q) => q.slot === i + 1) ?? null;
  }

  // Тикер для анимации кулдауна: только пока есть задача в кулдауне
  const hasCooldownTask = $derived(
    queue.some((q) => q.status === 'active' && q.progressOvm >= q.costOvm),
  );
  $effect(() => {
    if (!hasCooldownTask) return;
    const timer = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(timer);
  });

  /** Прогресс для отображения: набравшая стоимость задача «доисполняется»
   *  визуально в течение кулдауна (бар заполняется за taskCooldownSec). */
  function displayProgress(task: (typeof queue)[number]): number {
    if (task.status !== 'active' || task.progressOvm < task.costOvm) return task.progressOvm;
    const cooldownMs = (game.config?.taskCooldownSec ?? 3) * 1000;
    if (cooldownMs <= 0 || !task.activatedAt) return task.costOvm;
    const elapsed = now - new Date(task.activatedAt).getTime();
    return task.costOvm * Math.max(0, Math.min(1, elapsed / cooldownMs));
  }

  async function removeSlot(slot: 1 | 2 | 3) {
    try {
      const state = await api.queueRemove(slot);
      game.state = state;
      game.say('ЗАДАЧА УДАЛЕНА — ПРОГРЕСС СГОРЕЛ');
    } catch (err) {
      game.say(`${t('ОТКАЗ:')} ${(err as Error).message}`);
    }
    confirmSlot = null;
  }

  async function move(dir: 1 | -1) {
    const task = slotAt(cursor);
    if (!task || task.slot === 1) return;
    const to = task.slot + dir;
    if (to < 2 || to > 3) return;
    try {
      const state = await api.queueReorder(task.slot as 2 | 3, to as 2 | 3);
      game.state = state;
      cursor = to - 1;
    } catch (err) {
      game.say(`${t('ОТКАЗ:')} ${(err as Error).message}`);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (game.screen !== 'queue') return;
    const k = keyOf(e);
    if (confirmSlot !== null) {
      if (k === 'Enter' || k.toLowerCase() === 'y') void removeSlot(confirmSlot);
      else if (k === 'Escape' || k.toLowerCase() === 'n') confirmSlot = null;
      e.stopPropagation();
      return;
    }
    if (adding) {
      if (k === 'ArrowUp') addCursor = (addCursor + ACTION_TYPES.length - 1) % ACTION_TYPES.length;
      else if (k === 'ArrowDown') addCursor = (addCursor + 1) % ACTION_TYPES.length;
      else if (k === 'Enter') {
        adding = false;
        void game.chooseAction(ACTION_TYPES[addCursor] as ActionType);
      } else if (k === 'Escape') adding = false;
      e.stopPropagation();
      return;
    }
    if (k === 'ArrowUp') cursor = Math.max(0, cursor - 1);
    else if (k === 'ArrowDown') cursor = Math.min(2, cursor + 1);
    else if (k.toLowerCase() === 'a' || k === 'Insert') adding = true;
    else if (k === 'Delete' || k.toLowerCase() === 'd') {
      const task = slotAt(cursor);
      if (task) confirmSlot = task.slot;
    } else if (k === '+') void move(1);
    else if (k === '-') void move(-1);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="panel">
  <div class="panel-title">{t('ОЧЕРЕДЬ ЗАДАЧ БОРТОВОГО КОМПЬЮТЕРА')}</div>
  {#each [0, 1, 2] as i (i)}
    {@const task = slotAt(i)}
    <div
      class="slot selectable"
      class:selected={cursor === i}
      onclick={() => (cursor = i)}
      onkeydown={() => {}}
      role="button"
      tabindex="-1"
    >
      {#if task}
        <span class="accent">{t('СЛОТ')} {i + 1}</span>
        <span>{t(ACTION_LABELS[task.action])}</span>
        <span class={task.status === 'active' ? 'accent' : 'dim'}>
          [{task.status === 'active' ? t('ВЫПОЛНЯЕТСЯ') : t('ОЖИДАНИЕ')}]
        </span>
        <pre>{bar(displayProgress(task), task.costOvm, 40)} {fmtOvm(Math.min(task.progressOvm, task.costOvm))}/{fmtOvm(task.costOvm)} {t('ОВМ')}</pre>
      {:else}
        <span class="dim">{t('СЛОТ')} {i + 1} {t('— ПУСТО')}</span>
      {/if}
    </div>
  {/each}
  <p class="dim">
    {t('БУФЕР ОВМ:')} <span class="accent">{fmtOvm(game.state?.ovmBuffer ?? 0)}</span> /
    {fmtOvm(game.config?.ovmBufferCap ?? 100000)}
  </p>
</div>

{#if adding}
  <div class="panel overlay">
    <div class="panel-title">{t('ВЫБОР ДЕЙСТВИЯ')}</div>
    {#each ACTION_TYPES as action, i (action)}
      <div
        class="selectable"
        class:selected={addCursor === i}
        onclick={() => {
          adding = false;
          void game.chooseAction(action);
        }}
        onkeydown={() => {}}
        role="button"
        tabindex="-1"
      >
        {t(ACTION_LABELS[action])}
        <span class="dim">({game.config?.actionCosts[action] ?? '?'} {t('ОВМ')})</span>
      </div>
    {/each}
    <p class="dim">{t('[↑↓] ВЫБОР [ENTER] OK [ESC] ОТМЕНА')}</p>
  </div>
{/if}

{#if confirmSlot !== null}
  <div class="panel overlay">
    <p class="err">{t('УДАЛИТЬ ЗАДАЧУ ИЗ СЛОТА')} {confirmSlot}? {t('НАКОПЛЕННЫЙ ПРОГРЕСС СГОРИТ.')}</p>
    <p>{t('[ENTER/Y] ДА [ESC/N] НЕТ')}</p>
  </div>
{/if}

<p class="dim hint">{t('[A] ДОБАВИТЬ [D/DEL] УДАЛИТЬ [+/-] ПЕРЕСТАВИТЬ (СЛОТЫ 2-3) [↑↓] ВЫБОР')}</p>

<style>
  .slot {
    padding: 0.35rem 0.5rem;
    margin-bottom: 0.35rem;
    border: 1px dashed var(--term-dim);
  }
  .overlay {
    position: absolute;
    top: 30%;
    left: 50%;
    transform: translateX(-50%);
    background: var(--term-bg);
    min-width: 24rem;
    z-index: 10;
  }
  .hint {
    margin-top: 0.5rem;
  }
</style>
