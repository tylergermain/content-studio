/**
 * The Main Street window (E at a plot's FOR LEASE board or sign, or at the map board in Friday Park):
 * the street from above with who's where, and the plot picked on it. A street admin claims a plot
 * that's for lease for a business, as a building site or the shell of its tower, changes it, or gives
 * it back; everyone else sees what stands where. It follows the street as it changes, whoever changes
 * it, and keeps what an admin has typed unless the plot itself changes under them.
 */
import { CLAIMABLE, PLOTS, PLOT_IDS, isClaimable, type Claimable, type PlotId } from '../../../shared/mainstreet';
import type { BusinessCard, StreetClientMsg } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { clip, h, openModal, type Modal } from '../../ui/dom';
import { changes, cleanName, draftOf, plotForm, type Draft } from './form';
import { SKINS, STAGES, freshAccent, storeysText } from './look';
import { streetPlan, type PlanLot } from './map';
import './ui.css';

/** How long a change sent waits for the street to answer before the window stops saying it's on its way (ms). */
const WAIT_MS = 4000;
/** How long "Saved" stays up once it's done (ms). */
const DONE_MS = 2500;
/** How often the plan follows Friday One and the people on the street while it's open (ms). */
const FOLLOW_MS = 1000;
/** A color the plan can paint someone in. */
const COLOR = /^#[0-9a-f]{6}$/i;

/** What the plots that aren't for lease are, in a line or two. */
const ABOUT: Partial<Record<PlotId, string>> = {
  P1: "Friday Tower: Friday Labs' home, and Main Street's landmark. Its floors are the office; the roof bar is up top.",
  P5: "Friday Park: golf's first hole, two benches, the Main Street map board, and Friday One's heliport.",
  P6: 'Putt Street: nine holes of mini golf, windmill and all. E at the putter rack in the kiosk to play.',
};

const ADMINS_CLAIM = "Street admins (the office's admins) claim plots";

export interface StreetWindow {
  /** Picks `plot` out, as opening the window at that plot's board does. */
  show(plot?: PlotId): void;
  isOpen(): boolean;
}

/** Opens the Main Street window, on `first` when it's given. */
export function openStreetWindow(ctx: Ctx, first?: PlotId): StreetWindow {
  const cardOf = (p: Claimable): BusinessCard | undefined => store.plotCard(p);
  const admin = () => store.streetAdmin();
  /** The admin's drafts, by plot, and the card each was made from: a plot that changes under one drops it. */
  const drafts = new Map<Claimable, { draft: Draft; from: string }>();
  let selected: PlotId = first ?? (admin() ? CLAIMABLE.find((p) => !cardOf(p)) : CLAIMABLE.find((p) => cardOf(p))) ?? 'P2';
  /** A change on its way to the office: for which plot, what the plot was when it went, and how long to wait for it. */
  let pending: { plot: Claimable; was: string; until: number } | null = null;
  let statusTimer = 0;

  const plan = streetPlan((p) => show(p));
  const side = h('div.ms-side');
  const said = h('p.ms-status', { role: 'status' });
  const foot = h('span.grow');
  const el = h(
    'div.modal.ms-window',
    { role: 'dialog', 'aria-label': 'Main Street' },
    h('header', {}, h('h2', {}, '🏙️ Main Street')),
    h('div.body.ms-body', {}, h('div.ms-map', {}, plan.el, legend()), h('div.ms-pane', {}, side, said)),
    h('footer', {}, foot),
  );
  const offs: (() => void)[] = [];
  const follow = window.setInterval(() => drawPlan(), FOLLOW_MS);
  let modal: Modal | null = openModal(el, {
    doing: 'looking at Main Street',
    onClose: () => {
      modal = null;
      clearTimeout(statusTimer);
      clearInterval(follow);
      offs.forEach((off) => off());
    },
  });

  /** The draft for claimable plot `p`: the admin's, if the plot's as it was when they started it; else a fresh one. */
  function draftFor(p: Claimable): Draft {
    const card = cardOf(p);
    const from = JSON.stringify(card ?? null);
    const kept = drafts.get(p);
    if (kept && kept.from === from) return kept.draft;
    const draft: Draft = card ? draftOf(card) : { name: '', accent: freshAccent(store.street.cards), skin: 'glass', stage: 'site', planned: 4 };
    drafts.set(p, { draft, from });
    return draft;
  }

  /** The admin's draft for `p` when it's one worth drawing: named, and not what's there already. */
  function unsaved(p: Claimable): Draft | undefined {
    const d = admin() ? drafts.get(p)?.draft : undefined;
    return d && cleanName(d.name) && Object.keys(changes(d, cardOf(p))).length ? d : undefined;
  }

  /** What the plan was last drawn from: it's drawn again only when that changes (to the decimeter, for what moves). */
  let planned = '';
  function drawPlan() {
    const lots: Partial<Record<Claimable, PlanLot>> = {};
    for (const p of CLAIMABLE) {
      const card = cardOf(p);
      const d = p === selected ? unsaved(p) : undefined;
      if (d) lots[p] = { name: cleanName(d.name), accent: d.accent, stage: d.stage, planned: d.planned };
      else if (card) lots[p] = { name: card.name, accent: card.accent, stage: card.stage, planned: card.storeys.length };
    }
    const { pose } = store.heliPose;
    const down = !ctx.upTop();
    const you = down ? { x: dm(ctx.player.pos.x), z: dm(ctx.player.pos.z) } : null;
    // Whoever else is out at street level on your floor (the office counts everyone's, on every floor, before walls go up).
    const people: { x: number; z: number; color: string }[] = [];
    if (down) {
      for (const p of store.peers.values()) {
        const h = p.y - ctx.player.street;
        if (p.id !== store.you && !p.lite && store.onMyFloor(p) && h > -1 && h <= 3) people.push({ x: dm(p.x), z: dm(p.z), color: COLOR.test(p.color) ? p.color : '#8e8e93' });
      }
    }
    const st = { lots, selected, draft: isClaimable(selected) && !!unsaved(selected), heli: { x: dm(pose.x), z: dm(pose.z), yaw: Math.round(pose.yaw * 100) / 100 }, you, people };
    const key = JSON.stringify(st);
    if (key === planned) return;
    planned = key;
    plan.draw(st);
  }

  /** Says `text` under the form: a refusal until the next word, a success for a moment. */
  function say(text: string, tone: 'good' | 'bad' | '') {
    clearTimeout(statusTimer);
    said.textContent = text;
    said.className = `ms-status ${tone}`;
    if (tone === 'good') statusTimer = window.setTimeout(() => say('', ''), DONE_MS);
  }

  /** Sends a change for plot `p`, and says it's on its way until the street (or a refusal) answers. */
  function send(p: Claimable, msg: StreetClientMsg) {
    ctx.net.send(msg);
    pending = { plot: p, was: JSON.stringify(cardOf(p) ?? null), until: performance.now() + WAIT_MS };
    say('', '');
    drawSide();
    window.setTimeout(() => {
      if (!pending || performance.now() < pending.until) return;
      pending = null;
      drawSide();
    }, WAIT_MS + 50);
  }

  let form: ReturnType<typeof plotForm> | null = null;
  /** What the side was last drawn from: it's only drawn again when that changes, so typing in it is never cut off. */
  let drawn = '';
  function drawSide() {
    const p = selected;
    const card = isClaimable(p) ? cardOf(p) : undefined;
    const key = JSON.stringify([p, card ?? null, admin()]);
    if (key !== drawn) {
      drawn = key;
      side.replaceChildren(...sideFor(p, card));
    }
    form?.refresh(!!pending && pending.plot === p);
    const free = CLAIMABLE.filter((c) => !cardOf(c)).length;
    foot.textContent = `${free ? `${free} of ${CLAIMABLE.length} plots for lease` : 'Every plot is taken'}. ${admin() ? 'What you claim stands for everyone, on every floor, at once.' : 'Everyone, on every floor, sees the same street.'}`;
  }

  /** The picked plot: what it is, what stands on it, and for an admin, the form. */
  function sideFor(p: PlotId, card: BusinessCard | undefined): HTMLElement[] {
    form = null;
    const head = h('div.ms-head', {}, h('h3', {}, PLOTS[p].name));
    if (!isClaimable(p)) return [append(head, h('span.pill', {}, 'Friday Labs')), h('p.ms-about', {}, ABOUT[p] ?? '')];
    append(head, card ? h('span.pill.ms-pill', {}, `${STAGES[card.stage].icon} ${STAGES[card.stage].label}`) : h('span.pill', {}, 'For lease'));
    const out: HTMLElement[] = [head];
    if (card) out.push(cardView(card));
    if (!admin()) {
      if (!card) out.push(h('p.ms-about', {}, `${PLOTS[p].name} is for lease: a business could build its office here.`));
      out.push(h('p.ms-about.ms-quiet', {}, ADMINS_CLAIM));
      return out;
    }
    if (!card) out.push(h('p.ms-about', {}, `Claim ${PLOTS[p].name} for a business: it stands there for everyone, on every floor, as soon as you do.`));
    const draft = draftFor(p);
    form = plotForm({
      plot: p,
      card,
      draft,
      changed: drawPlan,
      claim: () => send(p, { t: 'street.claim', plot: p, ...draft, name: cleanName(draft.name) }),
      save: () => card && send(p, { t: 'street.edit', plot: p, id: card.id, ...changes(draft, card) }),
      release: () => card && send(p, { t: 'street.release', plot: p, id: card.id }),
    });
    out.push(form.el);
    return out;
  }

  /** The business on a plot as everyone sees it: its color, its name, and what stands there. */
  function cardView(c: BusinessCard): HTMLElement {
    const n = c.storeys.length;
    const what = c.stage === 'site' ? `Building site · ${storeysText(n)} planned` : `Shell · ${storeysText(n)}`;
    return h('div.ms-card', {}, h('span.ms-dot', { style: `background:${c.accent}` }), h('div.ms-card-text', {}, h('b', {}, clip(c.name, 32)), h('span', {}, `${what} · ${SKINS[c.skin].label}`)));
  }

  function show(p?: PlotId) {
    if (p && PLOT_IDS.includes(p) && p !== selected) {
      selected = p;
      say('', '');
    }
    drawPlan();
    drawSide();
  }

  offs.push(
    store.on('street', () => {
      // The plot a change was on its way to has changed: it landed (someone else's change to another plot isn't it).
      const p = pending?.plot;
      const done = !!p && JSON.stringify(cardOf(p) ?? null) !== pending!.was;
      if (done) pending = null;
      show();
      if (done && p === selected) say(cardOf(p) ? 'Saved: it’s up for everyone' : `${PLOTS[p].name} is for lease again`, 'good');
    }),
    store.on('me', () => show()),
    store.on('heli', drawPlan),
    ctx.messages.on('toast', (m) => {
      // Turned away: say why here too, where the admin is looking, and not only over the dimmed street.
      if (!pending || m.level !== 'warn' || !/^(🏙|🚁)/u.test(m.text)) return;
      pending = null;
      drawSide();
      say(m.text, 'bad');
    }),
  );
  show();
  // Straight into the name, on a plot that's for lease: a tick later, so the E that opened it isn't typed there.
  if (isClaimable(selected) && !cardOf(selected)) window.setTimeout(() => (side.querySelector('input[type=text]') as HTMLInputElement | null)?.focus({ preventScroll: true }), 60);

  return { show, isOpen: () => !!modal };
}

/** What the plan's marks mean. */
function legend(): HTMLElement {
  const item = (mark: string, words: string) => h('span', {}, h('i', { class: `ms-key-${mark}` }), words);
  return h('div.ms-legend', {}, item('lease', 'For lease'), item('site', 'Building site'), item('shell', 'Shell'), item('heli', 'Friday One'), item('you', 'You'));
}

/** `v` meters, to the decimeter. */
const dm = (v: number) => Math.round(v * 10) / 10;

function append(el: HTMLElement, ...kids: HTMLElement[]): HTMLElement {
  el.append(...kids);
  return el;
}
