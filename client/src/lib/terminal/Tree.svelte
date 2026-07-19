<script lang="ts" module>
  /**
   * Узел дерева. Ветка (children задан) разворачивается/сворачивается по
   * Enter; лист (children не задан) по Enter вызывает onactivate, если не
   * помечен `dim` — недоступные листья показываются, но не активируются
   * (ТЗ v0.02 п. 3.1: недоступные приказы видны, затенены, не выбираются).
   */
  export interface TreeNode {
    id: string;
    label: string;
    dim?: boolean;
    collapsedByDefault?: boolean;
    children?: TreeNode[];
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { keyOf } from './keys';

  /**
   * Плоская клавиатурная навигация по дереву (ТЗ v0.02 п. 3: дерево сущностей
   * → слоты приказов → доступные/недоступные). Видимый список — результат
   * обхода узлов с учётом свёрнутости; курсор — индекс в этом списке, поэтому
   * стрелки одинаково работают что на верхнем уровне, что внутри веток.
   *
   * `active` — слушать ли клавиатуру прямо сейчас: передайте
   * `game.screen === 'x' && !game.keysCaptured`, как это делает каждый экран.
   * Компонент не завязан на глобальный game — родитель решает, когда он живой.
   */
  interface Props {
    nodes: TreeNode[];
    active: boolean;
    onactivate: (node: TreeNode) => void;
  }
  let { nodes, active, onactivate }: Props = $props();

  interface Row {
    node: TreeNode;
    depth: number;
    isBranch: boolean;
  }

  // Свёрнутость — по id, переживает пересборку дерева между опросами.
  // Новые ветки (id ещё не встречался) сворачиваются по collapsedByDefault.
  let collapsed = $state<Set<string>>(new Set());
  let seenIds = new Set<string>();

  function seedDefaults(list: TreeNode[], next: Set<string>) {
    for (const n of list) {
      if (!n.children) continue;
      if (!seenIds.has(n.id)) {
        seenIds.add(n.id);
        if (n.collapsedByDefault) next.add(n.id);
      }
      seedDefaults(n.children, next);
    }
  }

  // untrack на чтении collapsed: эффект обязан перезапускаться только когда
  // меняются nodes, иначе чтение+запись одного $state в эффекте — та же ловушка,
  // что однажды намертво повесила клавиатуру в Overlay.svelte (см. его комментарий).
  $effect(() => {
    void nodes;
    untrack(() => {
      const next = new Set(collapsed);
      const before = next.size;
      seedDefaults(nodes, next);
      if (next.size !== before) collapsed = next;
    });
  });

  const rows = $derived.by(() => {
    const out: Row[] = [];
    const walk = (list: TreeNode[], depth: number) => {
      for (const node of list) {
        const isBranch = !!node.children;
        out.push({ node, depth, isBranch });
        if (isBranch && !collapsed.has(node.id)) walk(node.children!, depth + 1);
      }
    };
    walk(nodes, 0);
    return out;
  });

  let cursor = $state(0);
  $effect(() => {
    if (cursor >= rows.length) cursor = Math.max(0, rows.length - 1);
  });

  function toggle(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed = next;
  }

  function activate(row: Row) {
    if (row.isBranch) toggle(row.node.id);
    else if (!row.node.dim) onactivate(row.node);
  }

  function onKey(e: KeyboardEvent): void {
    if (!active || rows.length === 0) return;
    const k = keyOf(e);
    if (k === 'ArrowUp') cursor = Math.max(0, cursor - 1);
    else if (k === 'ArrowDown') cursor = Math.min(rows.length - 1, cursor + 1);
    else if (k === 'Enter') activate(rows[cursor]!);
    else if (k === 'ArrowRight' && rows[cursor]!.isBranch && collapsed.has(rows[cursor]!.node.id))
      toggle(rows[cursor]!.node.id);
    else if (k === 'ArrowLeft' && rows[cursor]!.isBranch && !collapsed.has(rows[cursor]!.node.id))
      toggle(rows[cursor]!.node.id);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="tree">
  {#each rows as row, i (row.node.id)}
    <div
      class="row selectable"
      class:selected={cursor === i}
      class:dim={row.node.dim}
      style="padding-left: {row.depth * 1.5}rem"
      onclick={() => {
        cursor = i;
        activate(row);
      }}
      onkeydown={() => {}}
      role="button"
      tabindex="-1"
    >
      {#if row.isBranch}
        <span class="glyph">{collapsed.has(row.node.id) ? '▸' : '▾'}</span>
      {:else}
        <span class="glyph">·</span>
      {/if}
      {row.node.label}
    </div>
  {/each}
</div>

<style>
  .tree {
    overflow-y: auto;
  }
  .row {
    white-space: pre;
    padding: 0.05rem 0.3rem;
  }
  .glyph {
    display: inline-block;
    width: 1.2rem;
    color: var(--term-dim);
  }
</style>
