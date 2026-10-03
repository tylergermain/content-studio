/**
 * The whisky cabinet (see shared/whisky.ts): E at one pours you a dram of The Macallan Litha from its
 * decanter, and the glass is in your hand. E sips it (when there's nothing in front of you E would use
 * instead), and you nurse it now and then of your own accord; empty, the glass goes back on the tray.
 * With someone else holding one within a couple of metres, K raises your glass: the glasses clink,
 * "🥃 Cheers" pops up over the heads of everyone in it, and now and then the floor hears who raised a
 * glass. Only what you do yourself sips your dram: a glass raised to you goes up for the clink, no more.
 * Everyone on the floor sees each pour, the glasses in people's hands, and the toast.
 */
import { GLASSES, POUR_EVERY_MS, SIPS, WHISKY_NAME, cheersLine } from '../../../shared/whisky';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { modalOpen, toast } from '../../ui/dom';
import type { Person } from '../../world/character';
import type { Interactable } from '../../world/types';
import { Dram } from './dram';
import { heldGlass, type HeldGlass } from './glass';
import { Partners, type Holder } from './partners';
import { Glasses, Pops } from './people';
import { Toast } from './toast';
import { CHEERS_KEY, showDram } from './ui';
import { Cabinets, POURED_AT } from './world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    whisky: true;
  }
}

export interface WhiskyDeps {
  /** Everyone else on your floor, as you see them, by peer id. */
  remotes: ReadonlyMap<string, { person: Person }>;
  /** What you're pointing at (first person) or standing at (third), if anything: E sips only with nothing there. */
  target(): Interactable | null;
}

/** How full someone else's glass looks: theirs to know, so it's a good pour. */
const THEIR_LEVEL = 0.75;

export function installWhisky(ctx: Ctx, deps: WhiskyDeps) {
  const cabinets = new Cabinets();
  const dram = new Dram();
  const toasting = new Toast(dram);
  const glasses = new Glasses();
  const pops = new Pops();
  const near = new Partners();
  /** When each pour under way is done and the glass is in its pourer's hand (seconds), by peer id. */
  const pouring = new Map<string, number>();
  let mine: HeldGlass | null = null;
  let lastAsk = -Infinity;
  ctx.usables.add({ usable: () => cabinets.usable() });

  const secs = () => performance.now() / 1000;
  /** Whether `id`'s glass is poured and in their hand by `now`. */
  const poured = (id: string, now: number) => now >= (pouring.get(id) ?? 0);
  /** Someone else on your floor holding a dram, as you see them. */
  const holder = (id: string): Holder | undefined => {
    if (id === store.you) return undefined;
    const p = store.peers.get(id);
    return p && store.onMyFloor(p) && !p.lite ? p : undefined;
  };
  const me = { id: '', x: 0, y: 0, z: 0 };

  /** Asks the office for a dram at the cabinet you're at (or for yours topped up): one pour at a time. */
  function pour(it: Interactable) {
    const now = secs();
    if (!it.pieceId || now - lastAsk < POUR_EVERY_MS / 1000 || (pouring.get(store.you) ?? 0) > now) return;
    lastAsk = now;
    ctx.net.send({ t: 'whisky.pour', piece: it.pieceId });
  }

  /**
   * A sip from your glass: up to your mouth (`raise`: in third person, a reach shows it), and down a
   * sip. The last one and the glass goes back.
   */
  function sip(now: number, raise = true) {
    if (!dram.sip(now)) return;
    if (ctx.player.view === 'first') ctx.hands.sip();
    else if (raise) ctx.me.reach();
    if (dram.holding) return;
    toasting.cancel();
    ctx.net.send({ t: 'whisky.down' });
    toast('🥃 That was the last of it: the glass goes back on the tray');
  }

  let lastCheers = -Infinity;
  /** Raises your glass to whoever's near with one of theirs (K). */
  function raise() {
    const now = secs();
    if (now - lastCheers < 2.5) return;
    lastCheers = now;
    ctx.net.send({ t: 'whisky.cheers' });
  }

  ctx.interactions.define('whisky', {
    reach: 2.4,
    hint: () => {
      const top = dram.holding && dram.level < 1;
      return {
        k: `${dram.holding}|${top}|${near.key}`,
        parts: [
          hintTitle(`🥃 ${WHISKY_NAME}`),
          aside(dram.holding ? 'your glass in hand' : 'neat, from the decanter'),
          dram.holding ? (top ? key('E', 'Top it up') : '') : key('E', 'Pour a dram'),
          near.names.length ? key(CHEERS_KEY, 'Cheers') : '',
        ],
      };
    },
    use: onE((it) => pour(it)),
  });

  // With a glass in hand, E sips (if E has nothing else to do here).
  ctx.keys.add('activity', (e) => {
    if (e.code !== 'KeyE' || !dram.holding || modalOpen() || ctx.upTop() || deps.target() || ctx.carrying()) return false;
    if (!e.repeat) sip(secs());
    return true;
  });
  // And K raises it to whoever's near with one of theirs: K is nobody else's, at a desk or anywhere.
  ctx.keys.bind({ code: `Key${CHEERS_KEY}`, repeat: false, when: () => dram.holding && near.names.length > 0 && !ctx.upTop(), run: () => raise() });

  ctx.messages.on('whisky.poured', (msg) => {
    const now = secs();
    // The next glass on the tray, or the last one if they're all out (a top-up comes back for a moment, refilled).
    const glass = Math.min(GLASSES - 1, Math.max(0, store.drams.size - 1));
    // Two at once take turns at the decanter; with a queue at it already, this one doesn't play.
    const start = cabinets.pour(msg.piece, glass, now);
    const ready = start === null ? now : start + POURED_AT;
    pouring.set(msg.id, ready);
    if (start !== null) {
      setTimeout(() => {
        const at = cabinets.at(msg.piece);
        if (at) ctx.sound.decant(at);
      }, (start - now) * 1000);
    }
    if (msg.id !== store.you) {
      deps.remotes.get(msg.id)?.person.reach();
      return;
    }
    dram.pour(now);
    setTimeout(() => {
      if (dram.holding) toast(`🥃 A dram of ${WHISKY_NAME}. E sips it, and ${CHEERS_KEY} clinks glasses with anyone near with one of their own`);
    }, (ready - now) * 1000);
  });

  ctx.messages.on('whisky.down', (msg) => {
    pouring.delete(msg.id);
    if (msg.id !== store.you) return;
    dram.putDown();
    toasting.cancel();
  });

  ctx.messages.on('whisky.cheers', (msg) => {
    const yours = toasting.heard(msg, store.you, secs());
    ctx.sound.cheers({ x: msg.x, y: msg.y + 1.3, z: msg.z });
    for (const id of msg.ids) {
      // Every glass in it goes up (yours too, as everyone else sees you), and "Cheers" over each head.
      glasses.toast(id);
      const person = id === store.you ? ctx.me : deps.remotes.get(id)?.person;
      if (person) pops.add(person);
    }
    // In first person, your glass goes up out to the side, so you see who you clink with.
    if (yours.raise && dram.holding && ctx.player.view === 'first') ctx.hands.toast();
    if (yours.told) toast(cheersLine(msg.names));
  });

  /** Each holder's entry in `holding`, kept from frame to frame. */
  const entries = new Map<string, { person: Person; level: number }>();
  store.on('whisky', () => {
    // Back on a floor where the office doesn't have you holding one (you came in a new way): none in hand.
    if (dram.holding && !store.drams.has(store.you)) {
      dram.putDown();
      toasting.cancel();
    }
    for (const id of entries.keys()) if (!store.drams.has(id)) entries.delete(id);
  });

  /** Everyone with a glass in hand this frame: the same map, and the same entry for each, every frame. */
  const holding = new Map<string, { person: Person; level: number }>();
  let inHandShown = false;
  ctx.ticks.add('others', ({ now: ms, dt }) => {
    const now = ms / 1000;
    cabinets.sync(ctx.office.furniture.all());
    // No cabinet on the floor and nobody with a glass (nor one still going up, or a "Cheers" still showing): nothing to do.
    if (!cabinets.size && !store.drams.size && !dram.holding && glasses.idle && pops.idle) {
      if (inHandShown) ctx.hands.holdInLeft(null);
      inHandShown = false;
      showDram(0, false, near);
      return;
    }
    cabinets.update(now, Math.min(GLASSES, store.drams.size));
    if (pouring.size) for (const [id, until] of pouring) if (now > until + 1) pouring.delete(id);
    if (dram.holding) {
      const { pos } = ctx.player;
      me.id = store.you;
      me.x = pos.x;
      me.y = pos.y;
      me.z = pos.z;
      near.find(me, store.drams, holder);
    } else near.clear();
    const mineIn = poured(store.you, now);
    // The sip to your own toast, once the glasses have clinked; or one now and then, nursing it.
    if (toasting.due(now)) sip(now);
    else if (dram.due(now) && mineIn && !modalOpen()) sip(now);

    // Your own glass in first person, once it's poured.
    const inHand = dram.holding && mineIn;
    if (inHand) (mine ??= heldGlass(1.1)).fill(dram.level);
    ctx.hands.holdInLeft(inHand ? mine!.group : null);
    inHandShown = inHand;

    // Everyone's glass in their hand, yours too (seen in third person).
    holding.clear();
    for (const id of store.drams) {
      if (!poured(id, now)) continue;
      const person = id === store.you ? (inHand ? ctx.me : undefined) : deps.remotes.get(id)?.person;
      if (!person) continue;
      let e = entries.get(id);
      if (!e) entries.set(id, (e = { person, level: THEIR_LEVEL }));
      e.person = person;
      e.level = id === store.you ? dram.level : THEIR_LEVEL;
      holding.set(id, e);
    }
    glasses.update(holding, dt);
    pops.update(dt);
    showDram(inHand ? Math.round(dram.level * SIPS) : 0, !deps.target() && !ctx.carrying(), near);
  });

  return { dram, cabinets };
}
