<script lang="ts">
  import { t } from '../i18n.svelte';
  import { keyOf } from './keys';
  import Overlay from './Overlay.svelte';

  /** Подтверждение необратимого действия. Клавиши обрабатывает сам. */
  interface Props {
    message: string;
    onconfirm: () => void;
    oncancel: () => void;
  }
  let { message, onconfirm, oncancel }: Props = $props();

  function onKey(e: KeyboardEvent) {
    const k = keyOf(e);
    if (k === 'Enter' || k.toLowerCase() === 'y') onconfirm();
    else if (k === 'Escape' || k.toLowerCase() === 'n') oncancel();
  }
</script>

<svelte:window onkeydown={onKey} />

<Overlay>
  <p class="err">{message}</p>
  <p>{t('[ENTER/Y] ДА [ESC/N] НЕТ')}</p>
</Overlay>
