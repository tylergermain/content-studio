/**
 * The boss's desk's windows: the desk's menu (share your screen, or pick a game), the window a guest
 * watches the boss's screen in, and the call strip they both carry, as does the game's bar.
 */
import { store } from '../../state';
import { h, openModal, setDoing, type Modal } from '../../ui/dom';
import type { Voice } from '../../voice';
import type { ScreenGame } from '../arcade/game';
import type { DeskPerson } from './desk';
import './ui.css';

/** Someone at the desk as the call strip shows them: whether they're in voice, and muted there. */
export interface CallPerson extends DeskPerson {
  voice?: boolean;
  muted?: boolean;
}

/**
 * Who's at the desk, with a dot that lights while each is talking, and one button for your mic: it
 * joins the call, and once you're in it, mutes you. Nothing shows while you're there alone. It keeps
 * itself up to date for as long as it's on the page.
 */
export function callStrip(voice: Voice, people: () => CallPerson[], join: () => void): HTMLElement {
  const chips = h('span.desk-chips');
  const mic = h('button.btn', { type: 'button' });
  const el = h('div.desk-call', {}, chips, mic);
  let drawn = '';
  const refresh = () => {
    const list = people();
    el.classList.toggle('hidden', list.length < 2 && !voice.inVoice);
    const k = `${list.map((p) => `${p.id}|${p.name}|${!!p.voice}|${!!p.muted}`).join('\n')}\n${voice.inVoice}|${voice.muted}`;
    if (k !== drawn) {
      drawn = k;
      chips.replaceChildren(
        ...list.map((p) => {
          const where = !p.voice ? 'not in the call' : p.muted ? 'muted' : 'in the call';
          return h('span.desk-chip', { 'data-peer': p.id, class: p.voice ? undefined : 'out', title: `${p.name}: ${where}` }, p.id === store.you ? 'You' : p.name, p.voice && p.muted ? ' 🔇' : '');
        }),
      );
      mic.textContent = !voice.inVoice ? '🎙️ Join the call' : voice.muted ? '🔇 Unmute' : '🎙️ Mute';
      mic.title = voice.inVoice ? 'Mute or unmute (M)' : 'Join voice (V)';
      mic.classList.toggle('primary', !voice.inVoice);
    }
    for (const chip of chips.children) chip.classList.toggle('speaking', voice.levelOf((chip as HTMLElement).dataset.peer!) > 0.04);
  };
  mic.addEventListener('click', () => {
    if (voice.inVoice) voice.toggleMute();
    else join();
    refresh();
  });
  refresh();
  // Until its window has closed (or, never put on the page, a few seconds have gone by).
  let seen = false;
  let waited = 0;
  const timer = setInterval(() => {
    if (el.isConnected) seen = true;
    else if (seen || ++waited > 20) return clearInterval(timer);
    refresh();
  }, 250);
  return el;
}

/**
 * The desk's menu, for whoever's in the boss's chair: one wide row to share your screen (or stop), and
 * a tile for each game on the monitor. What you picked last time says so and has the focus, so Enter
 * does it again.
 */
export function openDeskMenu(opts: {
  games: readonly ScreenGame[];
  /** What you did here last time: 'share', or a game's id. */
  last: string | null;
  /** A screen of yours is up already. */
  sharing: boolean;
  strip: HTMLElement;
  /** Called from the click itself, which is what lets the browser ask what to share. */
  share(): void;
  stopShare(): void;
  play(id: string): void;
  onClose(): void;
}): Modal {
  /** One thing to do at the desk: its name (marked when it's what you did last time) over a line about it. */
  const words = (name: string, about: string, last: boolean) => h('span.desk-text', {}, h('span.desk-name', {}, h('b', {}, name), last ? h('span.desk-last', {}, 'last time') : null), h('small', {}, about));
  let sharing = opts.sharing;
  const share = h('button.desk-row', { type: 'button' });
  const drawShare = () => {
    share.classList.toggle('on', sharing);
    share.replaceChildren(
      h('span.desk-icon', {}, sharing ? '⏹️' : '🖥️'),
      sharing ? words('Stop sharing', 'Your screen is up on both monitors', false) : words('Share my screen', 'It goes up on both monitors, for whoever sits across from you', opts.last === 'share'),
    );
  };
  drawShare();
  share.addEventListener('click', () => {
    if (!sharing) return opts.share();
    opts.stopShare();
    sharing = false;
    drawShare();
  });
  const tiles = opts.games.map((g) =>
    h('button.desk-tile', { type: 'button', 'data-game': g.id, onclick: () => opts.play(g.id) }, h('span.desk-icon', {}, g.icon), words(g.name, g.tip, opts.last === g.id)),
  );
  const el = h(
    'div.modal.desk-menu',
    { role: 'dialog', 'aria-label': 'Your desk' },
    h('header', {}, h('h2', {}, '👑 Your desk'), opts.strip),
    h(
      'div.body',
      {},
      share,
      h('div.desk-label', {}, 'Or play on your monitor'),
      h('div.desk-tiles', {}, ...tiles),
      h('p.setting-note', {}, 'Whoever sits across from you sees your game on the monitor facing them. A screen you’re sharing stays up instead.'),
    ),
  );
  const modal = openModal(el, { onClose: () => opts.onClose() });
  // Enter does what you did last time again. Not with your screen up already, where that row stops it.
  (opts.last === 'share' ? (sharing ? null : share) : tiles.find((t) => t.dataset.game === opts.last))?.focus();
  return modal;
}

/**
 * A guest's window onto the boss's screen: the picture when there's one, a card saying who's at the
 * desk when there isn't (and the window's a small one then), and the call strip in its header. It
 * follows the screen coming and going (see `show`) without closing.
 */
export function openDeskViewer(opts: { who: string; strip: HTMLElement; onClose(): void }): { modal: Modal; show(stream: MediaStream | null, card: { icon: string; title: string; line: string }): void } {
  const video = h('video.hidden', { autoplay: true, playsinline: true });
  video.muted = true;
  const empty = h('div.desk-empty');
  const title = h('h2');
  const el = h('div.modal.viewer.desk-view', { role: 'dialog', 'aria-label': `${opts.who}'s desk` }, h('header', {}, title, opts.strip), video, empty);
  const modal = openModal(el, {
    onClose: () => {
      video.srcObject = null;
      opts.onClose();
    },
  });
  let shown: MediaStream | null | undefined;
  let drawn = '';
  function show(stream: MediaStream | null, card: { icon: string; title: string; line: string }) {
    if (stream !== shown) {
      shown = stream;
      video.srcObject = stream;
      if (stream) void video.play().catch(() => {});
      video.classList.toggle('hidden', !stream);
      empty.classList.toggle('hidden', !!stream);
      // With no picture it's a call, in a window the size of one; a screen gets all the room there is.
      el.classList.toggle('calling', !stream);
      title.textContent = stream ? `🖥️ ${opts.who}'s screen` : `👑 ${opts.who}'s desk`;
      setDoing(modal, stream ? `🖥️ watching ${opts.who}'s screen` : undefined);
    }
    const k = `${card.icon}|${card.title}|${card.line}`;
    if (k === drawn) return;
    drawn = k;
    empty.replaceChildren(h('span.desk-icon', {}, card.icon), h('b', {}, card.title), h('span', {}, card.line), h('small', {}, 'Their screen comes up here when they share it, or play a game'));
  }
  return { modal, show };
}
