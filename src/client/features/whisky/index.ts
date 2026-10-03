/**
 * The whisky cabinet (see shared/whisky.ts): E at one pours you a dram of The Macallan Litha from its
 * decanter, and the glass is in your hand. E sips it (when there's nothing in front of you E would use
 * instead), and you nurse it now and then of your own accord; empty, the glass goes back on the tray.
 * With someone else holding one within a couple of metres, K raises your glass: near enough, the
 * glasses reach in and clink between you (clink.ts), further off they're raised to each other;
 * "🥃 Cheers" pops up over the heads of everyone in it, and now and then the floor hears who raised a
 * glass. Only what you do yourself sips your dram: a glass raised to you goes up for the clink, no more.
 * Everyone on the floor sees each pour, the glasses in people's hands, and the toast.
 */
import * as THREE from 'three';
import { GLASSES, POUR_EVERY_MS, SIPS, WHISKY_NAME, cheersLine } from '../../../shared/whisky';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { modalOpen, toast } from '../../ui/dom';
import { EYE_HEIGHT } from '../../player';
import type { Person } from '../../world/character';
import type { Interactable } from '../../world/types';
import { CLINK_AT, TOAST_SECONDS, toastPoses, toastStep, type Raised, type Toaster } from './clink';
import { Dram } from './dram';
import { GLASS, heldGlass, type HeldGlass } from './glass';
import { Partners, type Holder } from './partners';
import { Glasses, HAND_GLASS, Pops } from './people';
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
/** How big your own glass is in first person (in your hand, under the camera). */
const MY_GLASS = 1.1;
/** How far off a cabinet is out of sight enough to have its decanter filled again (metres), as well as off the screen. */
const OUT_OF_SIGHT = 14;

/** A toast under way: who's in it (whoever raised it first, then the rest), when it started (seconds), and whether the glasses have met yet. */
interface Raising {
  ids: readonly string[];
  at: number;
  clinked: boolean;
}

const frustum = new THREE.Frustum();
const viewing = new THREE.Matrix4();
const aim = new THREE.Vector3();

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
    // What it's for, with the first glass only: a top-up goes without saying.
    if (msg.top) return;
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

  /** The toasts under way, and where each glass in them goes this frame (see clink.ts). */
  const toasts: Raising[] = [];
  const raising = new Map<string, { raised: Raised; t: number }>();
  ctx.messages.on('whisky.cheers', (msg) => {
    const yours = toasting.heard(msg, store.you, secs());
    // Every glass in it goes up (yours too, as everyone else sees you), and "Cheers" over each head;
    // the glasses clink as they meet (see the frame below).
    toasts.push({ ids: msg.ids, at: secs(), clinked: false });
    for (const id of msg.ids) {
      const person = id === store.you ? ctx.me : deps.remotes.get(id)?.person;
      if (person) pops.add(person);
    }
    if (yours.told) toast(cheersLine(msg.names));
  });

  /** Where `id` stands as you see them, with how big the glass they hold looks, or nothing if you can't see them. */
  function stood(id: string): Toaster | null {
    if (id === store.you) {
      const { pos, view } = ctx.player;
      return { id, x: pos.x, y: pos.y, z: pos.z, r: GLASS.r * (view === 'first' ? MY_GLASS : HAND_GLASS) };
    }
    const at = deps.remotes.get(id)?.person.root.position;
    return at ? { id, x: at.x, y: at.y, z: at.z, r: GLASS.r * HAND_GLASS } : null;
  }

  /** Each toast going on: where each glass in it goes now, and the clink as they meet. */
  function toastsGoOn(now: number) {
    raising.clear();
    for (let i = toasts.length - 1; i >= 0; i--) {
      const toast = toasts[i];
      const t = now - toast.at;
      if (t > TOAST_SECONDS) {
        toasts.splice(i, 1);
        continue;
      }
      const people = toast.ids.map(stood).filter((p): p is Toaster => !!p);
      // Seen through your own eyes, where they meet comes up into view.
      const poses = toastPoses(people, ctx.player.view === 'first' ? { id: store.you, height: EYE_HEIGHT } : undefined);
      for (const r of poses) raising.set(r.id, { raised: r, t });
      if (toast.clinked || t < CLINK_AT) continue;
      toast.clinked = true;
      // Heard where they meet: only glasses that do meet clink.
      const met = poses.filter((r) => r.touch);
      if (met.length > 1) ctx.sound.cheers({ x: met.reduce((s, r) => s + r.x, 0) / met.length, y: met[0].y, z: met.reduce((s, r) => s + r.z, 0) / met.length });
    }
  }

  /** Your own glass in first person, in a toast: to where it meets the other in front of you (theirs comes to it), or raised toward them. */
  function aimYours() {
    const mine = raising.get(store.you);
    if (!mine || ctx.player.view !== 'first') return ctx.hands.aimHeld(null);
    const step = toastStep(mine.t, mine.raised.touch);
    const r = mine.raised;
    const { camera } = ctx;
    camera.updateMatrixWorld();
    camera.worldToLocal(aim.set(r.x - r.tx * step.gap, r.y + step.lift, r.z - r.tz * step.gap));
    // Its foot, from its middle; not if it's somewhere behind you (you've turned away).
    aim.y -= (GLASS.h * MY_GLASS) / 2;
    ctx.hands.aimHeld(aim.z < -0.15 ? aim : null, step.k);
  }

  /** Whether a decanter at `at` is out of sight: off the screen, or far off. */
  function unseen(at: THREE.Vector3): boolean {
    const { camera } = ctx;
    if (camera.position.distanceTo(at) > OUT_OF_SIGHT) return true;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewing.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    return !frustum.containsPoint(at);
  }

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
  /** The furniture's version the cabinets were last looked for in (see FurnitureView.version). */
  let furnished = -1;
  ctx.ticks.add('others', ({ now: ms, dt }) => {
    const now = ms / 1000;
    // The floor's cabinets, looked for again only when its furniture has been stood anew.
    const { furniture } = ctx.office;
    if (furniture.version !== furnished) {
      furnished = furniture.version;
      cabinets.sync(furniture.all());
    }
    // No cabinet on the floor and nobody with a glass (nor one still going up, or a "Cheers" still showing): nothing to do.
    if (!cabinets.size && !store.drams.size && !dram.holding && glasses.idle && pops.idle && !toasts.length) {
      if (inHandShown) ctx.hands.holdInLeft(null);
      inHandShown = false;
      showDram(0, false, near);
      return;
    }
    cabinets.update(now, Math.min(GLASSES, store.drams.size), unseen);
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
    if (inHand) (mine ??= heldGlass(MY_GLASS)).fill(dram.level);
    ctx.hands.holdInLeft(inHand ? mine!.group : null);
    inHandShown = inHand;
    toastsGoOn(now);
    aimYours();

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
    glasses.update(holding, raising);
    pops.update(dt);
    showDram(inHand ? Math.round(dram.level * SIPS) : 0, !deps.target() && !ctx.carrying(), near);
  });

  return { dram, cabinets };
}
