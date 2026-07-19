<script lang="ts">
  import { game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';
  import { bar, pad } from '../lib/terminal/format';

  /**
   * Трюм принадлежит сущности, а не игроку (ТЗ v0.02 п. 3.2: добыча физически
   * локализована). Показываем выбранную во «Флотилии» сущность, иначе ведущую.
   */
  const entity = $derived(game.selectedEntity);
  const items = $derived(entity?.cargo ?? []);
  const used = $derived(entity?.cargoUsed ?? 0);
  const cap = $derived(entity?.cargoCapacity ?? 0);
</script>

<div class="panel">
  <div class="panel-title">{t('ТРЮМ')}{entity ? `: ${entity.name}` : ''}</div>
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
