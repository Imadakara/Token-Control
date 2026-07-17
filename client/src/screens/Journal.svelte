<script lang="ts">
  import { game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';

  $effect(() => {
    if (game.screen === 'journal') void game.refreshJournal();
  });
</script>

<div class="panel journal">
  <div class="panel-title">{t('ЖУРНАЛ ОПЕРАЦИЙ')}</div>
  {#if game.journal.length === 0}
    <p class="dim">{t('ЗАПИСЕЙ НЕТ')}</p>
  {/if}
  {#each game.journal as entry (entry.id)}
    <pre><span class="dim">{new Date(entry.ts).toLocaleString('ru-RU')}</span>  <span
        class={entry.result.startsWith('НЕВЫПОЛНИМО') ? 'err' : ''}>{entry.result}</span></pre>
  {/each}
</div>

<style>
  .journal {
    max-height: 70vh;
    overflow-y: auto;
  }
</style>
