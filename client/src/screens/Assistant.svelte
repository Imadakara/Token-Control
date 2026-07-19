<script lang="ts">
  import type { ChatMessage, ResolvedCall } from '../lib/assistant.svelte';
  import { askAssistant, buildFleetContext, resolveToolCall } from '../lib/assistant.svelte';
  import { api } from '../lib/api';
  import { game } from '../lib/game.svelte';
  import { t } from '../lib/i18n.svelte';
  import Confirm from '../lib/terminal/Confirm.svelte';

  /**
   * Ассистент (ТЗ v0.02 п. 7): вопрос в рамках открытой Базы Знаний за ОВМ,
   * либо команда флоту — исполняется только через штатные REST-эндпоинты
   * (game.enqueue/api.techResearch), после подтверждения игроком. Свободный
   * текст модели, не оформленный как tool-call, никогда не исполняется.
   */

  interface DisplayMessage {
    role: 'user' | 'assistant' | 'system';
    text: string;
  }

  let messages = $state<DisplayMessage[]>([]);
  let input = $state('');
  let busy = $state(false);
  let pendingCall = $state<Exclude<ResolvedCall, { kind: 'error' }> | null>(null);
  let messagesEl: HTMLDivElement | undefined;
  let confirmResolve: (() => void) | null = null;

  $effect(() => {
    void messages.length;
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  function pushMsg(role: DisplayMessage['role'], text: string): void {
    messages = [...messages, { role, text }];
  }

  function historyForModel(): ChatMessage[] {
    return messages
      .filter((m): m is DisplayMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.text }));
  }

  function waitForConfirm(): Promise<void> {
    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  }

  async function onConfirmYes(): Promise<void> {
    if (pendingCall?.kind === 'order') {
      await game.enqueue(pendingCall.action, pendingCall.params, [pendingCall.entityId]);
      pushMsg('system', game.message);
    } else if (pendingCall?.kind === 'research') {
      try {
        game.state = await api.techResearch(pendingCall.techId);
        pushMsg('system', t('ТЕХНОЛОГИЯ ИЗУЧЕНА'));
      } catch (err) {
        pushMsg('system', `${t('ОТКАЗ:')} ${(err as Error).message}`);
      }
    }
    pendingCall = null;
    confirmResolve?.();
    confirmResolve = null;
  }

  function onConfirmNo(): void {
    pushMsg('system', t('ВЫБОР ОТМЕНЁН'));
    pendingCall = null;
    confirmResolve?.();
    confirmResolve = null;
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || busy || !game.state) return;
    input = '';
    pushMsg('user', text);
    busy = true;
    try {
      const prep = await api.assistantPrepare();
      game.say(`${t('БУФЕР')}: ${prep.ovmBuffer}`);
      const [available, techsRes] = await Promise.all([api.ordersAvailable(), api.tech()]);
      const state = game.state;
      const fleetContext = buildFleetContext(state, available, game.galaxy);

      const res = await askAssistant({
        userText: text,
        history: historyForModel(),
        systemPrompt: prep.systemPrompt,
        entries: prep.entries,
        fleetContext,
      });

      if (res.toolCalls.length > 0) {
        for (const call of res.toolCalls) {
          const resolved = resolveToolCall(call, {
            state,
            available,
            galaxy: game.galaxy,
            techs: techsRes.techs,
          });
          if (resolved.kind === 'error') {
            pushMsg('system', resolved.message);
          } else {
            pendingCall = resolved;
            await waitForConfirm();
          }
        }
      } else if (res.content) {
        pushMsg('assistant', res.content);
      } else {
        pushMsg('system', t('АССИСТЕНТ НЕ ДАЛ ОТВЕТА'));
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      pushMsg('system', `${t('АССИСТЕНТ НЕДОСТУПЕН:')} ${reason}`);
    }
    busy = false;
  }
</script>

<div class="panel chat-panel">
  <div class="panel-title">{t('АССИСТЕНТ')}</div>
  <div class="messages" bind:this={messagesEl}>
    {#if messages.length === 0}
      <p class="dim">{t('СПРОСИТЕ ЧТО-НИБУДЬ ИЛИ ОТДАЙТЕ КОМАНДУ ФЛОТУ')}</p>
    {/if}
    {#each messages as m, i (i)}
      <p class={m.role === 'user' ? 'user-msg' : m.role === 'system' ? 'dim' : 'assistant-msg'}>
        <span class="role">{m.role === 'user' ? '>' : m.role === 'assistant' ? t('АССИСТЕНТ:') : '·'}</span>
        {m.text}
      </p>
    {/each}
    {#if busy}
      <p class="dim">{t('АССИСТЕНТ ДУМАЕТ...')}</p>
    {/if}
  </div>
  <form
    class="input-row"
    onsubmit={(e) => {
      e.preventDefault();
      void send();
    }}
  >
    <input bind:value={input} placeholder={t('СООБЩЕНИЕ...')} disabled={busy} />
    <button type="submit" disabled={busy || !input.trim()}>{t('ОТПРАВИТЬ')}</button>
  </form>
</div>

{#if pendingCall}
  <Confirm
    message={`${t('АССИСТЕНТ ХОЧЕТ:')} ${pendingCall.description}`}
    onconfirm={() => void onConfirmYes()}
    oncancel={onConfirmNo}
  />
{/if}

<style>
  .chat-panel {
    display: flex;
    flex-direction: column;
    height: calc(100% - 3rem);
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    margin-bottom: 0.5rem;
  }
  .messages p {
    margin: 0.3rem 0;
  }
  .role {
    color: var(--term-accent);
    margin-right: 0.4rem;
  }
  .user-msg .role {
    color: var(--term-fg);
  }
  .input-row {
    display: flex;
    gap: 0.5rem;
  }
  .input-row input {
    flex: 1;
  }
</style>
