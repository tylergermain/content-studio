/**
 * The whisky cabinet (see shared/whisky.ts): E at one pours you a dram of The Macallan Litha from its
 * decanter, and the glass is in your hand. E sips it (when there's nothing in front of you E would use
 * instead), and you nurse it now and then of your own accord; empty, the glass goes back on the tray.
 * With someone else holding one within a couple of metres, C raises your glass: the glasses clink,
 * "🥃 Cheers" pops up over both heads, and the floor hears who raised a glass. Everyone on the floor sees
 * each pour, the glasses in people's hands, and the toast.
 */
import { GLASSES, SIPS, WHISKY_NAME, cheersLine, clinkWith } from '../../../shared/whisky';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { modalOpen, toast } from '../../ui/dom';
import type { Person } from '../../world/character';
import type { Interactable } from '../../world/types';
import { Dram } from './dram';
import { heldGlass, type HeldGlass } from './glass';
import { Glasses, Pops } from './people';
import { showDram } from './ui';
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
  const glasses = new Glasses();
  const pops = new Pops();
  /** When each pour under way is done and the glass is in its pourer's hand (seconds), by peer id. */
  const pouring = new Map<string, number>();
  let mine: HeldGlass | null = null;
  let lastAsk = 0;
  ctx.usables.add({ usable: () => cabinets.usable() });

  const secs = () => performance.now() / 1000;
  /** Everyone near enough to clink glasses with (see CLINK), by name, nearest first. */
  function partners(): string[] {
    if (!dram.holding) return [];
    const { pos } = ctx.player;
    const others = [...store.drams].flatMap((id) => {
      const p = id === store.you ? undefined : store.peers.get(id);
      return p && store.onMyFloor(p) && !p.lite ? [p] : [];
    });
    return clinkWith({ id: store.you, x: pos.x, y: pos.y, z: pos.z }, others).map((p) => p.name);
  }

  /** Asks the office for a dram at the cabinet you're at (or for yours topped up). */
  function pour(it: Interactable) {
    const now = secs();
    if (!it.pieceId || now - lastAsk < 1.5 || (pouring.get(store.you) ?? 0) > now) return;
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
    ctx.net.send({ t: 'whisky.down' });
    toast('🥃 That was the last of it: the glass goes back on the tray');
  }

  let lastCheers = 0;
  function raise() {
    const now = secs();
    if (now - lastCheers < 2.5) return;
    lastCheers = now;
    ctx.net.send({ t: 'whisky.cheers' });
  }

  ctx.interactions.define('whisky', {
    reach: 2.4,
    hint: () => {
      const near = partners();
      const top = dram.holding && dram.level < 1;
      return {
        k: `${dram.holding}|${top}|${near.join(',')}`,
        parts: [
          hintTitle(`🥃 ${WHISKY_NAME}`),
          aside(dram.holding ? 'your glass in hand' : 'neat, from the decanter'),
          dram.holding ? (top ? key('E', 'Top it up') : '') : key('E', 'Pour a dram'),
          near.length ? key('C', 'Cheers') : '',
        ],
      };
    },
    use: onE((it) => pour(it)),
  });

  // With a glass in hand: C raises it to whoever's near with one of theirs, and E sips (if E has nothing else to do).
  ctx.keys.add('activity', (e) => {
    if (!dram.holding || modalOpen() || ctx.upTop()) return false;
    if (e.code === 'KeyC') {
      if (!partners().length) return false;
      if (!e.repeat) raise();
      return true;
    }
    if (e.code === 'KeyE' && !deps.target() && !ctx.carrying()) {
      if (!e.repeat) sip(secs());
      return true;
    }
    return false;
  });

  ctx.messages.on('whisky.poured', (msg) => {
    const now = secs();
    // The next glass on the tray, or the last one if they're all out (a top-up comes back for a moment, refilled).
    const glass = Math.min(GLASSES - 1, Math.max(0, store.drams.size - 1));
    // Two at once take turns at the decanter.
    const start = cabinets.pour(msg.piece, glass, now);
    pouring.set(msg.id, start + POURED_AT);
    setTimeout(() => {
      const at = cabinets.at(msg.piece);
      if (at) ctx.sound.decant(at);
    }, (start - now) * 1000);
    if (msg.id !== store.you) {
      deps.remotes.get(msg.id)?.person.reach();
      return;
    }
    dram.pour(now);
    setTimeout(
      () => {
        if (dram.holding) toast(`🥃 A dram of ${WHISKY_NAME}. E sips it, and C clinks glasses with anyone near with one of their own`);
      },
      (start - now + POURED_AT) * 1000,
    );
  });

  ctx.messages.on('whisky.down', (msg) => {
    pouring.delete(msg.id);
    if (msg.id === store.you) dram.putDown();
  });

  ctx.messages.on('whisky.cheers', (msg) => {
    const now = secs();
    ctx.sound.cheers({ x: msg.x, y: msg.y + 1.3, z: msg.z });
    for (const id of msg.ids) {
      // Every glass goes up (yours too, as everyone else sees you).
      glasses.toast(id);
      if (id === store.you) {
        pops.add(ctx.me);
        // And a sip to it: in first person, the glass comes up to your mouth.
        sip(now, false);
        continue;
      }
      const person = deps.remotes.get(id)?.person;
      if (person) pops.add(person);
    }
    toast(cheersLine(msg.names));
  });

  // Back on a floor where the office doesn't have you holding one (you came in a new way): none in hand.
  store.on('whisky', () => {
    if (dram.holding && !store.drams.has(store.you)) dram.putDown();
  });

  ctx.ticks.add('others', ({ now: ms, dt }) => {
    const now = ms / 1000;
    cabinets.sync(ctx.office.furniture.all());
    cabinets.update(now, Math.min(GLASSES, store.drams.size));
    for (const [id, until] of pouring) if (now > until + 1) pouring.delete(id);
    const poured = (id: string) => now >= (pouring.get(id) ?? 0);
    if (dram.due(now) && poured(store.you) && !modalOpen()) sip(now);

    // Your own glass in first person, once it's poured.
    const inHand = dram.holding && poured(store.you);
    if (inHand) (mine ??= heldGlass(1.1)).fill(dram.level);
    ctx.hands.holdInLeft(inHand ? mine!.group : null);

    // Everyone's glass in their hand, yours too (seen in third person).
    const holding = new Map<string, { person: Person; level: number }>();
    for (const id of store.drams) {
      if (!poured(id)) continue;
      if (id === store.you) {
        if (inHand) holding.set(id, { person: ctx.me, level: dram.level });
        continue;
      }
      const person = deps.remotes.get(id)?.person;
      if (person) holding.set(id, { person, level: THEIR_LEVEL });
    }
    glasses.update(holding, dt);
    pops.update(dt);
    showDram({ sips: inHand ? Math.round(dram.level * SIPS) : 0, canSip: !deps.target() && !ctx.carrying(), near: partners() });
  });

  return { dram, cabinets };
}
