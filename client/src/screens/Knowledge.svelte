<script lang="ts">
  import {
    ENTITY_CLASSES,
    MODULES,
    type Capability,
    type KnowledgeBranch,
    type KnowledgeEntry,
    type TechStatus,
  } from '@tokencontrol/shared';
  import { api } from '../lib/api';
  import { ACTION_LABELS, game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';
  import Confirm from '../lib/terminal/Confirm.svelte';
  import Tree, { type TreeNode } from '../lib/terminal/Tree.svelte';

  /**
   * База Знаний и Технологии (ТЗ v0.02 пп. 5–6): список открытых записей
   * (с поиском по строке) и дерево технологий. Доступность и недостающие
   * условия считает сервер (game/knowledge.ts) — здесь только отрисовка.
   */

  const BRANCH_LABELS: Record<KnowledgeBranch, string> = {
    nav: 'НАВИГАЦИЯ',
    ind: 'ПРОМЫШЛЕННОСТЬ',
    def: 'ОБОРОНА',
  };

  let entries = $state<KnowledgeEntry[]>([]);
  let techs = $state<TechStatus[]>([]);
  let filter = $state('');
  let selected = $state<{ kind: 'entry' | 'tech'; id: string } | null>(null);
  let pendingResearch = $state<TechStatus | null>(null);

  async function load() {
    const [k, tr] = await Promise.all([api.knowledge(), api.tech()]);
    entries = k.entries;
    techs = tr.techs;
  }

  // Перезагружаем при входе на экран и при каждом обновлении буфера — от него
  // зависит researchable (ТЗ v0.02 п. 6), тот же каданс, что у /orders/available.
  $effect(() => {
    if (game.screen !== 'knowledge') return;
    void game.state?.ovmBuffer;
    void load();
  });

  const filteredEntries = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.title.toLowerCase().includes(q) || e.tags.some((tag) => tag.includes(q)),
    );
  });

  function techReason(tech: TechStatus): string {
    if (tech.missingRequires.length > 0) {
      const names = tech.missingRequires
        .map((id) => techs.find((x) => x.id === id)?.title ?? id)
        .join(', ');
      return `ТРЕБУЕТСЯ: ${names}`;
    }
    if (tech.missingEntries.length > 0) return 'НЕДОСТАТОЧНО ДАННЫХ';
    return 'НЕДОСТАТОЧНО ОВМ';
  }

  const nodes: TreeNode[] = $derived([
    {
      id: 'root:entries',
      label: `${t('ЗАПИСИ')} (${filteredEntries.length}/${entries.length})`,
      children: filteredEntries.map((e) => ({ id: `entry:${e.id}`, label: e.title })),
    },
    {
      id: 'root:tech',
      label: `${t('ТЕХНОЛОГИИ')} (${techs.filter((x) => x.researched).length}/${techs.length})`,
      children: techs.map((tech) => ({
        id: `tech:${tech.id}`,
        label: tech.researched
          ? `✓ ${tech.title}`
          : `${tech.title} (${tech.dataCost.ovm} ${t('ОВМ')})${
              !tech.researchable ? ` — ${t(techReason(tech))}` : ''
            }`,
        dim: !tech.researched && !tech.researchable,
      })),
    },
  ]);

  function onactivate(node: TreeNode) {
    const [kind, id] = node.id.split(':') as ['entry' | 'tech', string];
    if (kind === 'entry') {
      selected = { kind: 'entry', id };
    } else if (kind === 'tech') {
      selected = { kind: 'tech', id };
      const tech = techs.find((x) => x.id === id);
      if (tech && !tech.researched && tech.researchable) pendingResearch = tech;
    }
  }

  async function confirmResearch() {
    if (!pendingResearch) return;
    try {
      game.state = await api.techResearch(pendingResearch.id);
      game.say('ТЕХНОЛОГИЯ ИЗУЧЕНА');
      await load();
    } catch (err) {
      game.say(`${t('ОТКАЗ:')} ${(err as Error).message}`);
    }
    pendingResearch = null;
  }

  function capabilityLabel(c: Capability): string {
    if (c.kind === 'order') return `${t('ПРИКАЗ')}: ${t(ACTION_LABELS[c.order])}`;
    if (c.kind === 'module') return `${t('МОДУЛЬ')}: ${t(MODULES[c.moduleId]?.title ?? c.moduleId)}`;
    if (c.kind === 'class')
      return `${t('КЛАСС')}: ${t(ENTITY_CLASSES[c.classId]?.title ?? c.classId)}`;
    return `${t('ПОСТРОЙКА')}: ${c.objectKind}`;
  }

  const selectedEntry = $derived(
    selected?.kind === 'entry' ? entries.find((e) => e.id === selected!.id) : undefined,
  );
  const selectedTech = $derived(
    selected?.kind === 'tech' ? techs.find((x) => x.id === selected!.id) : undefined,
  );
</script>

<div class="wrap">
  <div class="panel tree-panel">
    <div class="panel-title">{t('БАЗА ЗНАНИЙ И ТЕХНОЛОГИИ')}</div>
    <input
      class="search"
      placeholder={t('ПОИСК ПО ЗАПИСЯМ...')}
      bind:value={filter}
    />
    {#if entries.length === 0 && techs.length === 0}
      <p class="dim">{t('ЗАГРУЗКА...')}</p>
    {:else}
      <Tree {nodes} active={game.screen === 'knowledge' && !game.keysCaptured} {onactivate} />
    {/if}
  </div>

  <div class="panel info">
    <div class="panel-title">{t('ИНФОРМАЦИЯ')}</div>
    {#if selectedEntry}
      <pre>
{t('НАЗВАНИЕ').padEnd(14, '.')} {selectedEntry.title}
{t('ВЕТКА').padEnd(14, '.')} {t(BRANCH_LABELS[selectedEntry.branch])}</pre>
      <p>{selectedEntry.body}</p>
      <p class="dim">{selectedEntry.tags.join(', ')}</p>
    {:else if selectedTech}
      <pre>
{t('НАЗВАНИЕ').padEnd(14, '.')} {selectedTech.title}
{t('ВЕТКА').padEnd(14, '.')} {t(BRANCH_LABELS[selectedTech.branch])}
{t('СТАТУС').padEnd(14, '.')} {selectedTech.researched ? t('ИЗУЧЕНА') : t('НЕ ИЗУЧЕНА')}
{t('СТОИМОСТЬ').padEnd(14, '.')} {selectedTech.dataCost.ovm} {t('ОВМ')}</pre>
      {#if selectedTech.requires.length > 0}
        <p class="dim">{t('ТРЕБУЕТ:')} {selectedTech.requires.map((id) => techs.find((x) => x.id === id)?.title ?? id).join(', ')}</p>
      {/if}
      {#if selectedTech.dataCost.entryIds.length > 0}
        <p class="dim">{t('ДАННЫЕ:')} {selectedTech.dataCost.entryIds.map((id) => entries.find((e) => e.id === id)?.title ?? id).join(', ')}</p>
      {/if}
      {#if selectedTech.unlocks.length > 0}
        <p class="accent">{t('ОТКРЫВАЕТ:')} {selectedTech.unlocks.map(capabilityLabel).join(', ')}</p>
      {/if}
      {#if !selectedTech.researched}
        <p class={selectedTech.researchable ? 'accent' : 'err'}>
          {selectedTech.researchable ? t('ГОТОВА К ИЗУЧЕНИЮ [ENTER]') : t(techReason(selectedTech))}
        </p>
      {/if}
    {:else}
      <p class="dim">{t('НАВЕДИТЕ КУРСОР НА ЗАПИСЬ ИЛИ ТЕХНОЛОГИЮ')}</p>
    {/if}
  </div>
</div>

{#if pendingResearch}
  <Confirm
    message={`${t('ИЗУЧИТЬ')} «${pendingResearch.title}» ${t('ЗА')} ${pendingResearch.dataCost.ovm} ${t('ОВМ')}?`}
    onconfirm={() => void confirmResearch()}
    oncancel={() => (pendingResearch = null)}
  />
{/if}

<p class="dim hint">{t('[↑↓] ВЫБОР [←→] СВЕРНУТЬ/РАЗВЕРНУТЬ [ENTER] ВЫБРАТЬ/ИЗУЧИТЬ')}</p>

<style>
  .wrap {
    display: flex;
    gap: 0.75rem;
    align-items: stretch;
    height: calc(100% - 3rem);
  }
  .tree-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .tree-panel :global(.tree) {
    flex: 1;
  }
  .search {
    width: 100%;
    margin-bottom: 0.4rem;
  }
  .info {
    min-width: 26rem;
    overflow-y: auto;
  }
  .hint {
    margin-top: 0.5rem;
  }
</style>
