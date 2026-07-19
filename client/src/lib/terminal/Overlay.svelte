<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { game } from '../game.svelte';
  import { t } from '../i18n.svelte';

  /**
   * Модальный бокс поверх экрана. Сам регистрируется в game.modalDepth, поэтому
   * пока он открыт, App не перехватывает цифры и Esc — экранам не нужно возиться
   * со stopPropagation (оно всё равно не работало: обработчик App висит на window
   * и зарегистрирован раньше экранных).
   */
  interface Props {
    title?: string;
    children: Snippet;
  }
  let { title, children }: Props = $props();

  // untrack обязателен: `+=` читает и пишет один и тот же $state внутри
  // эффекта — Svelte считает это небезопасной мутацией, эффект падает, и
  // счётчик залипает выше нуля, намертво отключая клавиши всех экранов.
  $effect(() => {
    untrack(() => (game.modalDepth += 1));
    return () => untrack(() => (game.modalDepth -= 1));
  });
</script>

<div class="panel overlay">
  {#if title}<div class="panel-title">{t(title)}</div>{/if}
  {@render children()}
</div>

<style>
  .overlay {
    position: absolute;
    top: 30%;
    left: 50%;
    transform: translateX(-50%);
    background: var(--term-bg);
    min-width: 24rem;
    /* Ниже CRT-слоя (z-index 100), иначе модалка сломает эффект */
    z-index: 10;
  }
</style>
