<script lang="ts" generics="T">
  import { t } from '../i18n.svelte';
  import { keyOf } from './keys';
  import Overlay from './Overlay.svelte';

  /**
   * Модальный список с курсором: стрелки, Enter, Esc, клик мышью.
   * Курсор ходит по кругу — список короткий, упереться в край раздражает.
   */
  interface Props {
    title: string;
    items: readonly T[];
    label: (item: T) => string;
    /** Приглушённая приписка справа (например, стоимость в ОВМ). */
    note?: (item: T) => string;
    /** Недоступные показываем затенёнными и не даём выбрать (ТЗ v0.02 п. 3.1). */
    disabled?: (item: T) => boolean;
    onpick: (item: T) => void;
    oncancel: () => void;
  }
  let { title, items, label, note, disabled, onpick, oncancel }: Props = $props();

  let cursor = $state(0);

  function pick(item: T) {
    if (disabled?.(item)) return;
    onpick(item);
  }

  function onKey(e: KeyboardEvent) {
    const k = keyOf(e);
    if (items.length === 0) {
      if (k === 'Escape') oncancel();
      return;
    }
    if (k === 'ArrowUp') cursor = (cursor + items.length - 1) % items.length;
    else if (k === 'ArrowDown') cursor = (cursor + 1) % items.length;
    else if (k === 'Enter') pick(items[cursor]!);
    else if (k === 'Escape') oncancel();
  }
</script>

<svelte:window onkeydown={onKey} />

<Overlay {title}>
  {#if items.length === 0}
    <p class="dim">{t('НЕТ ВАРИАНТОВ')}</p>
  {/if}
  {#each items as item, i (i)}
    <div
      class="selectable"
      class:selected={cursor === i}
      class:dim={disabled?.(item)}
      onclick={() => pick(item)}
      onmouseenter={() => (cursor = i)}
      onkeydown={() => {}}
      role="button"
      tabindex="-1"
    >
      {label(item)}
      {#if note}<span class="dim">{note(item)}</span>{/if}
    </div>
  {/each}
  <p class="dim">{t('[↑↓] ВЫБОР [ENTER] OK [ESC] ОТМЕНА')}</p>
</Overlay>
