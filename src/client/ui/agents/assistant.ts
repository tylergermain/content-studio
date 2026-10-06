import { h, timeAgo } from '../dom';
import { markdownFile } from '../markdown';
import { store } from '../../state';
import { ASSISTANT_ASKS, type AssistantState, type PlanUsage } from '../../../shared/assistant';

// The executive assistant in the Agents panel (panel.ts): its conversation, what it's doing while it works (the
// office commands it runs), the plans' usage as meters, quick asks, and the box to ask it anything. It lives on the
// server (server/assistant/): this only shows it and asks it, every second and a half while it's on screen.

const FAST_MS = 1500, SLOW_MS = 6000;
const resetsIn = (at?: number) => {
  if (!at) return '';
  const m = Math.max(0, Math.round((at - Date.now()) / 60_000));
  return m < 60 ? `resets in ${m}m` : m < 2880 ? `resets in ${Math.round(m / 60)}h` : `resets in ${Math.round(m / 1440)}d`;
};

async function call(path: string, body?: unknown): Promise<AssistantState> {
  const res = await fetch(`/api/assistant${path}`, body === undefined ? { credentials: 'same-origin', cache: 'no-store' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(body as object), by: store.me.account?.name ?? store.profile.name }) });
  const out = await res.json().catch(() => undefined);
  if (!res.ok || !out) throw new Error(out?.error ?? 'The assistant didn\u2019t answer');
  return out;
}

function meters(plans: PlanUsage[]): HTMLElement {
  if (!plans.length) return h('p.as-muted', {}, 'Plan usage shows here once Codex or Claude Code has reported it.');
  return h('div.as-plans', {}, ...plans.map((p) => h('div.as-plan', {},
    h('div.as-plan-head', {}, h('strong', {}, p.provider === 'codex' ? 'Codex' : 'Claude'), p.plan ? h('span.as-muted', {}, ` \u00b7 ${p.plan}`) : '', p.credits ? h('span.as-muted', {}, ` \u00b7 ${Number(p.credits).toLocaleString()} credits`) : ''),
    ...p.windows.map((w) => h('div.as-window', { title: `${Math.round(w.pct)}% of this ${w.label}\u2019s limit used` },
      h('span.as-window-label', {}, w.label === 'week' ? 'This week' : `${w.label}`),
      h('span.as-bar', {}, h('span', { style: `width:${Math.min(100, Math.max(0, w.pct))}%`, class: w.pct >= 85 ? 'hot' : w.pct >= 60 ? 'warm' : '' })),
      h('span.as-pct', {}, `${Math.round(w.pct)}%`),
      h('span.as-reset', {}, resetsIn(w.resetsAt)))))));
}

export function assistantPane() {
  let state: AssistantState | undefined;
  let error = '';
  let timer = 0;
  let shownStamp = '';
  let confirmReset = false;
  let stick = true;

  const status = h('span.as-status');
  const reset = h('button.as-link', { type: 'button', title: 'Start a new conversation: it forgets what was said' }, 'New conversation');
  const plans = h('div.as-plans-box');
  const convo = h('div.as-convo');
  convo.addEventListener('scroll', () => (stick = convo.scrollHeight - convo.scrollTop - convo.clientHeight < 40));
  const asks = h('div.as-asks', {}, ...ASSISTANT_ASKS.map((a) => {
    const b = h('button.as-ask', { type: 'button' }, a.label);
    b.addEventListener('click', () => void ask(a.text));
    return b;
  }));
  const box = h('textarea.rr-input.as-box', { rows: 2, maxlength: 8000, placeholder: 'Ask your assistant anything\u2026', 'aria-label': 'Ask your assistant' }) as HTMLTextAreaElement;
  const send = h('button.rr-send.as-send', { type: 'button' }, 'Ask');
  const note = h('p.rr-status');
  const element = h('div.as-pane', {},
    h('div.as-head', {}, h('div.as-title', {}, h('span.as-face', { 'aria-hidden': 'true' }, '\u{1f9d1}\u200d\u{1f4bc}'), h('strong', {}, 'Assistant'), status), reset),
    plans, convo,
    h('div.rr-compose.as-compose', {}, asks, box, h('div.rr-compose-row', {}, h('span.rr-hint', {}, 'Enter asks \u00b7 Shift+Enter for a new line'), send), note));

  async function ask(text: string) {
    const t = text.trim();
    if (!t) return;
    send.disabled = true;
    try {
      state = await call('/ask', { text: t });
      box.value = '';
      error = '';
      stick = true;
      paint();
      schedule(FAST_MS);
    } catch (e) {
      note.textContent = e instanceof Error ? e.message : 'That couldn\u2019t be asked';
    } finally {
      send.disabled = false;
    }
  }
  send.addEventListener('click', () => void ask(box.value));
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void ask(box.value);
    }
  });
  reset.addEventListener('click', async () => {
    if (!confirmReset) {
      confirmReset = true;
      reset.textContent = 'Start over? Click again';
      setTimeout(() => {
        confirmReset = false;
        reset.textContent = 'New conversation';
      }, 4000);
      return;
    }
    confirmReset = false;
    reset.textContent = 'New conversation';
    state = await call('/reset', {}).catch(() => state);
    paint();
  });

  function paint() {
    if (!state) {
      status.textContent = error || 'Waking up\u2026';
      return;
    }
    status.textContent = state.busy ? `Working${state.queued ? ` \u00b7 ${state.queued} waiting` : ''}\u2026` : 'Ready';
    status.classList.toggle('busy', state.busy);
    plans.replaceChildren(meters(state.plans), h('p.as-muted.as-used', {}, `Its own answers: ${(state.used.input - state.used.cached + state.used.output).toLocaleString()} new tokens over ${state.used.turns} turn${state.used.turns === 1 ? '' : 's'}`));
    const stamp = JSON.stringify([state.messages.map((m) => m.id), state.busy, state.doing, state.error]);
    if (stamp === shownStamp) return;
    shownStamp = stamp;
    const items: HTMLElement[] = state.messages.map((m) => m.role === 'user'
      ? h('div.as-msg.user', {}, h('p', {}, m.text), h('span.as-when', {}, `${m.by ?? 'You'} \u00b7 ${timeAgo(m.at)}`))
      : h('div.as-msg.assistant', {}, markdownFile(m.text), m.steps?.length ? h('div.as-steps', {}, ...[...new Set(m.steps)].map((s) => h('span.as-step', {}, s))) : '', h('span.as-when', {}, timeAgo(m.at))));
    if (state.busy) items.push(h('div.as-msg.assistant.thinking', {}, h('p', {}, h('span.as-dots', {}, '\u2022\u2022\u2022'), ' ', state.doing.length ? `Running ${state.doing[state.doing.length - 1]}` : 'Thinking'), state.doing.length > 1 ? h('div.as-steps', {}, ...state.doing.slice(0, -1).map((s) => h('span.as-step', {}, s))) : ''));
    if (state.error && !state.busy) items.push(h('div.as-msg.error', {}, h('p', {}, state.error)));
    if (!items.length) items.push(h('div.as-empty', {}, h('strong', {}, 'Your executive assistant'), h('p', {}, 'It keeps your agents organized: ask what everyone\u2019s doing, who can go home, or whether you\u2019re using your tokens well. It can message, wake and send agents home, and start new tasks.')));
    convo.replaceChildren(...items);
    if (stick) requestAnimationFrame(() => (convo.scrollTop = convo.scrollHeight));
  }

  async function refresh() {
    try {
      state = await call('');
      error = '';
      note.textContent = '';
    } catch (e) {
      error = e instanceof Error ? e.message : 'The assistant didn\u2019t answer';
      note.textContent = error;
    }
    paint();
    schedule(state?.busy || state?.queued ? FAST_MS : SLOW_MS);
  }
  function schedule(ms: number) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => (element.isConnected && !element.hidden && document.visibilityState === 'visible' ? void refresh() : schedule(ms)), ms);
  }

  return {
    element,
    start() {
      void refresh();
    },
    stop() {
      window.clearTimeout(timer);
    },
    focus: () => box.focus({ preventScroll: true }),
    ask: (text: string) => void ask(text),
  };
}
