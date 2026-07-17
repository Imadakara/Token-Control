<script lang="ts">
  import { game } from './lib/game.svelte';
  import { t } from './lib/i18n.svelte';

  let name = $state(localStorage.getItem('tc_player') ?? '');
  let error = $state('');
  let busy = $state(false);

  async function submit() {
    if (busy || !name.trim()) return;
    busy = true;
    error = '';
    try {
      await game.login(name.trim());
      localStorage.setItem('tc_player', name.trim());
    } catch (err) {
      error = (err as Error).message;
    }
    busy = false;
  }
</script>

<main class="login">
  <pre class="accent">
╔════════════════════════════════════╗
║        T O K E N   C O N T R O L   ║
║        БОРТОВОЙ КОМПЬЮТЕР v0.0.1   ║
╚════════════════════════════════════╝</pre>
  <p class="dim">{t('DEV-РЕЖИМ: STEAM-АВТОРИЗАЦИЯ БУДЕТ ПОДКЛЮЧЕНА ПОЗЖЕ')}</p>
  <p>
    {t('ПОЗЫВНОЙ КАПИТАНА:')}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      autofocus
      bind:value={name}
      maxlength="64"
      onkeydown={(e) => e.key === 'Enter' && submit()}
    />
    <button onclick={submit} disabled={busy}>{t('ВХОД')}</button>
  </p>
  {#if error}<p class="err">{t('ОТКАЗ:')} {error}</p>{/if}
</main>

<style>
  .login {
    padding: 2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>
