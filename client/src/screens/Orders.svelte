<script lang="ts">
  import type { OrderOption } from '@tokencontrol/shared';
  import { api } from '../lib/api';
  import { ACTION_LABELS, entityStatusText, game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';
  import { bar, fmtOvm } from '../lib/terminal/format';
  import Confirm from '../lib/terminal/Confirm.svelte';
  import Tree, { type TreeNode } from '../lib/terminal/Tree.svelte';

  /**
   * Приказы (ТЗ v0.02 п. 3): очередь задач как инструмент управления флотом.
   * Дерево — сущность → её слоты приказов → доступные приказы → свёрнутый
   * список недоступных с причинами. Доступность считает сервер (game/orders.ts),
   * это лишь отрисовка.
   */

  const fleet = $derived(game.entities);

  // Доступные приказы кэшируются по entityId и пересчитываются при каждом
  // новом снапшоте состояния — так же, как карты обновляются в applyState.
  let availableByEntity = $state<Record<string, OrderOption[]>>({});
  let requestSeq = 0;

  $effect(() => {
    const ids = fleet.map((e) => e.id);
    if (ids.length === 0) return;
    const seq = ++requestSeq;
    void api.ordersAvailable().then(({ entities }) => {
      if (seq !== requestSeq) return; // устаревший ответ — новее уже в пути
      const next: Record<string, OrderOption[]> = {};
      for (const e of entities) next[e.entityId] = e.orders;
      availableByEntity = next;
    });
  });

  let cancelTarget = $state<{ entityId: string; slot: number } | null>(null);

  async function cancelOrder() {
    if (!cancelTarget) return;
    try {
      game.state = await api.ordersRemove(cancelTarget.entityId, cancelTarget.slot);
      game.say('ПРИКАЗ ОТМЕНЁН — ПРОГРЕСС СГОРЕЛ');
    } catch (err) {
      game.say(`${t('ОТКАЗ:')} ${(err as Error).message}`);
    }
    cancelTarget = null;
  }

  function nodesFor(entity: (typeof fleet)[number]): TreeNode {
    const options = availableByEntity[entity.id] ?? [];
    const available = options.filter((o) => o.available);
    const unavailable = options.filter((o) => !o.available);

    const queued: TreeNode[] = entity.orders.map((o) => ({
      id: `${entity.id}:slot:${o.slot}`,
      label: `${o.slot}. ${t(ACTION_LABELS[o.action])} [${
        o.status === 'active' ? t('ВЫПОЛНЯЕТСЯ') : t('ОЖИДАНИЕ')
      }] ${bar(o.progressOvm, o.costOvm, 24)} ${fmtOvm(Math.min(o.progressOvm, o.costOvm))}/${fmtOvm(o.costOvm)} ${t('ОВМ')}`,
    }));

    const availableNode: TreeNode = {
      id: `${entity.id}:available`,
      label: `${t('ДОСТУПНЫЕ ПРИКАЗЫ')} (${available.length})`,
      children: available.map((o) => ({
        id: `${entity.id}:avail:${o.action}`,
        label: `${t(ACTION_LABELS[o.action])} (${o.costOvm} ${t('ОВМ')})`,
      })),
    };

    const unavailableNode: TreeNode = {
      id: `${entity.id}:unavailable`,
      label: `${t('НЕДОСТУПНЫЕ')} (${unavailable.length})`,
      collapsedByDefault: true,
      children: unavailable.map((o) => ({
        id: `${entity.id}:unavail:${o.action}`,
        label: `${t(ACTION_LABELS[o.action])} — ${o.reason ? t(o.reason) : ''}`,
        dim: true,
      })),
    };

    return {
      id: `entity:${entity.id}`,
      label: `${entity.name} [${entityStatusText(entity)}]`,
      children: [...queued, availableNode, unavailableNode],
    };
  }

  const nodes = $derived(fleet.map(nodesFor));

  // Tree вызывает onactivate только для листьев (ветки сама сворачивает/
  // разворачивает), так что здесь встречаются лишь два вида id:
  // "<entityId>:slot:<n>" (отменить приказ) и "<entityId>:avail:<action>"
  // (поставить приказ) — недоступные листья дальше не пропускает сам Tree.
  function onactivate(node: TreeNode) {
    const [entityId, tag, rest] = node.id.split(':');
    if (tag === 'slot') cancelTarget = { entityId: entityId!, slot: Number(rest) };
    else if (tag === 'avail') {
      void game.chooseAction(rest as Parameters<typeof game.chooseAction>[0], [entityId!]);
    }
  }
</script>

<div class="panel wrap">
  <div class="panel-title">{t('ПРИКАЗЫ')}</div>
  {#if fleet.length === 0}
    <p class="dim">{t('НЕТ СУЩНОСТЕЙ')}</p>
  {:else}
    <Tree {nodes} active={game.screen === 'orders' && !game.keysCaptured} {onactivate} />
  {/if}
</div>

{#if cancelTarget}
  <Confirm
    message={t('ОТМЕНИТЬ ПРИКАЗ? НАКОПЛЕННЫЙ ПРОГРЕСС СГОРИТ.')}
    onconfirm={() => void cancelOrder()}
    oncancel={() => (cancelTarget = null)}
  />
{/if}

<p class="dim hint">{t('[↑↓] ВЫБОР [←→] СВЕРНУТЬ/РАЗВЕРНУТЬ [ENTER] ВЫБРАТЬ/ОТМЕНИТЬ')}</p>

<style>
  .wrap {
    height: calc(100% - 3rem);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .wrap :global(.tree) {
    flex: 1;
  }
  .hint {
    margin-top: 0.5rem;
  }
</style>
