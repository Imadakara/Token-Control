<script lang="ts">
  import { game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';
  import { bar, pad } from '../lib/terminal/format';

  const items = $derived(game.state?.cargo ?? []);
  const used = $derived(items.reduce((s, i) => s + i.qty, 0));
  const cap = $derived(game.state?.cargoCapacity ?? 0);
</script>

<div class="panel">
  <div class="panel-title">{t('ТРЮМ')}</div>
  <pre>{t('ЗАНЯТО:')} {bar(used, cap, 30)} {used}/{cap}</pre>
  {#if items.length === 0}
    <p class="dim">{t('ТРЮМ ПУСТ')}</p>
  {:else}
    <pre class="accent">{pad(t('НАИМЕНОВАНИЕ'), 30)}{t('КОЛ-ВО')}</pre>
    {#each items as item (item.itemType)}
      <pre>{pad(item.itemType.toUpperCase(), 30)}{item.qty}</pre>
    {/each}
  {/if}
</div>
