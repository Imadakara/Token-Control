<script lang="ts">
  import Login from './Login.svelte';
  import Crt from './lib/terminal/Crt.svelte';
  import { game } from './lib/game.svelte';
  import { SCREENS, screenDef } from './lib/screens';
  import { t } from './lib/i18n.svelte';
  import { bar, fmtOvm } from './lib/terminal/format';
  import { keyOf } from './lib/terminal/keys';

  if (game.authorized) void game.start();

  const Current = $derived(screenDef(game.screen).component);

  /** Приказ, который сейчас получает поток ОВМ (ТЗ v0.02 п. 3: буфер общий). */
  const flowEntity = $derived(
    game.entities.find((e) => e.orders[0]?.status === 'active') ?? null,
  );
  const activeOrder = $derived(flowEntity?.orders[0] ?? null);

  function cycleScreen(dir: 1 | -1) {
    const i = SCREENS.findIndex((s) => s.id === game.screen);
    game.screen = SCREENS[(i + dir + SCREENS.length) % SCREENS.length]!.id;
  }

  function onKey(e: KeyboardEvent) {
    if (!game.authorized) return;
    // Модалка открыта или курсор в текстовом поле — клавиши не наши
    if (game.keysCaptured) return;
    // Модификаторы принадлежат браузеру/ОС, а не игровому меню
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = keyOf(e);
    if (k === 'Escape') {
      game.cancelPick();
      return;
    }
    if (game.pick) return;
    if (k === 'Tab') {
      cycleScreen(e.shiftKey ? -1 : 1);
      e.preventDefault();
      return;
    }
    const item = SCREENS.find((s) => s.key === k);
    if (item) game.screen = item.id;
  }
</script>

<svelte:window onkeydown={onKey} />

{#if game.crt}<Crt />{/if}

{#if !game.authorized}
  <Login />
{:else}
  <div class="terminal">
    <header>
      <span class="accent">TOKEN CONTROL</span>
      <span class:dim={!game.online} class:err={!game.online}>
        {game.online ? t('● СВЯЗЬ') : t('○ НЕТ СВЯЗИ')}
      </span>
      <span>{t('ПОТОК:')} <span class="accent">{fmtOvm(game.ratePerMin)}</span> {t('ОВМ/МИН')}</span>
      {#if activeOrder && flowEntity}
        <span>
          {flowEntity.name}:
          <span class="accent">{bar(activeOrder.progressOvm, activeOrder.costOvm, 16)}</span>
          {Math.floor((activeOrder.progressOvm / activeOrder.costOvm) * 100)}%
        </span>
      {:else}
        <span class="dim">{t('ПРИКАЗОВ НЕТ → БУФЕР')} {fmtOvm(game.state?.ovmBuffer ?? 0)}</span>
      {/if}
    </header>

    <nav>
      {#each SCREENS as item (item.id)}
        <button
          class:active={game.screen === item.id}
          onclick={() => !game.pick && (game.screen = item.id)}
        >
          <span class="key">{item.key}</span>
          {t(item.label)}
        </button>
      {/each}
    </nav>

    <main>
      <Current />
    </main>

    <footer>
      <span class="dim">&gt;</span>
      {t(game.message) || t('СИСТЕМЫ В НОРМЕ')}
    </footer>
  </div>
{/if}

<style>
  .terminal {
    height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0.75rem;
    gap: 0.4rem;
  }
  header {
    display: flex;
    gap: 1.5rem;
    border-bottom: 1px solid var(--term-dim);
    padding-bottom: 0.3rem;
  }
  nav {
    display: flex;
    gap: 0.4rem;
  }
  nav button.active {
    background: var(--term-sel-bg);
    border-color: var(--term-fg);
  }
  main {
    flex: 1;
    overflow: hidden;
    position: relative;
  }
  footer {
    border-top: 1px solid var(--term-dim);
    padding-top: 0.3rem;
    min-height: 1.6rem;
  }
</style>
