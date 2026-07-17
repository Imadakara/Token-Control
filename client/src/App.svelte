<script lang="ts">
  import Login from './Login.svelte';
  import Crt from './lib/terminal/Crt.svelte';
  import { game, type Screen } from './lib/game.svelte';
  import { t } from './lib/i18n.svelte';
  import { bar, fmtOvm } from './lib/terminal/format';
  import { keyOf } from './lib/terminal/keys';
  import Queue from './screens/Queue.svelte';
  import SectorMap from './screens/SectorMap.svelte';
  import GalaxyMap from './screens/GalaxyMap.svelte';
  import Cargo from './screens/Cargo.svelte';
  import Status from './screens/Status.svelte';
  import Journal from './screens/Journal.svelte';
  import Settings from './screens/Settings.svelte';

  const MENU: { key: string; id: Screen; label: string }[] = [
    { key: '1', id: 'queue', label: 'ОЧЕРЕДЬ' },
    { key: '2', id: 'sector', label: 'СЕКТОР' },
    { key: '3', id: 'galaxy', label: 'ГАЛАКТИКА' },
    { key: '4', id: 'cargo', label: 'ТРЮМ' },
    { key: '5', id: 'status', label: 'СТАТУС' },
    { key: '6', id: 'journal', label: 'ЖУРНАЛ' },
    { key: '7', id: 'settings', label: 'НАСТРОЙКИ' },
  ];

  if (game.authorized) void game.start();

  const activeTask = $derived(game.state?.queue.find((q) => q.slot === 1) ?? null);

  function onKey(e: KeyboardEvent) {
    if (!game.authorized) return;
    const k = keyOf(e);
    if (k === 'Escape') {
      game.cancelPick();
      return;
    }
    const item = MENU.find((m) => m.key === k);
    if (item && !game.pick) game.screen = item.id;
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
      {#if activeTask}
        <span>
          {t('СЛОТ 1:')} <span class="accent">{bar(activeTask.progressOvm, activeTask.costOvm, 16)}</span>
          {Math.floor((activeTask.progressOvm / activeTask.costOvm) * 100)}%
        </span>
      {:else}
        <span class="dim">{t('ОЧЕРЕДЬ ПУСТА → БУФЕР')} {fmtOvm(game.state?.ovmBuffer ?? 0)}</span>
      {/if}
    </header>

    <nav>
      {#each MENU as item (item.id)}
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
      {#if game.screen === 'queue'}<Queue />
      {:else if game.screen === 'sector'}<SectorMap />
      {:else if game.screen === 'galaxy'}<GalaxyMap />
      {:else if game.screen === 'cargo'}<Cargo />
      {:else if game.screen === 'status'}<Status />
      {:else if game.screen === 'journal'}<Journal />
      {:else if game.screen === 'settings'}<Settings />{/if}
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
