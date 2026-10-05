/**
 * Friday One, the helicopter on its pad in Friday Park (see protocol/heli.ts and shared/heli.ts): street
 * admins fly it and anyone can ride along. E within reach of a door gets you in (at the controls, or in
 * a passenger's seat) and out again once it's down. Everyone, on every floor, sees and hears it: it's
 * drawn by world.ts (the heliPark street fixture) at each floor's own street level, and from the roof
 * bar by roof.ts. The pilot's page flies it (controller.ts); everyone else's follows the office's word
 * of where it is (follow.ts).
 */
import { SEAT_HIPS } from '../../../shared/garage';
import { HELI, LAND_HOLD, doorDistance, groundUnder, type FlyWorld, type HeliInput } from '../../../shared/heli';
import { heliSolids, heliTerrain, heliTerrainOver, whyNotLand } from '../../../shared/heli-world';
import { STREET_Y, roofDrop } from '../../../shared/layout';
import type { HeliCrew, HeliPose, HeliSeat, PeerInfo } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { builtFloors } from '../../core/floors';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { DESK_KEYS } from '../../interaction';
import { groundAt } from '../../player';
import { store } from '../../state';
import { $, clip, toast } from '../../ui/dom';
import type { Person } from '../../world/character';
import { ROOF_LIFT } from '../../world/mainstreet/layout';
import type { Interactable } from '../../world/types';
import type { ViewWorld } from './camera';
import { Pilot } from './controller';
import { PoseFollower } from './follow';
import { LandingCheck, underneath, washOver } from './land';
import { ROTOR_TURNS, heliPoint } from './model';
import { Ride } from './ride';
import { HeliRoof } from './roof';
import type { RotorState } from './sound';
import { HeliHud, heliStatus } from './ui';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    heli: true;
  }
}

export interface HeliDeps {
  /** Up off whatever you're sitting on (see features/seating). */
  standUp(): void;
  /** Stops a walk over to someone, if you're on one. */
  stopWalking(): void;
  /** Someone on your floor, as you see them. */
  personOf(id: string): Person | undefined;
  /** How many storeys the roof stands on (see features/rooftop): how tall Friday Tower is to fly round. */
  roofFloors(): number;
}

/** After E gets you out, the office still listing you aboard (it hasn't heard yet) doesn't put you back in for this long (ms). */
const LEAVING = 3000;
/** The rotor's angle goes round by this before starting again, a whole number of turns of the tail rotor too. */
const ROUND = Math.PI * 10;
/** How often the chip over the screen is redrawn (ms): it's numbers, not motion. */
const HUD_EVERY = 100;

export function installHeli(ctx: Ctx, deps: HeliDeps) {
  const { player } = ctx;
  const park = () => ctx.office.heli;
  const roof = new HeliRoof(ctx.scene);
  /** Where it's drawn while someone else flies it (or nobody does), from the office's word. */
  const follow = new PoseFollower();
  /** At the controls, your own flight. */
  const pilot = new Pilot({
    send: (pose, landed) => ctx.net.send({ t: 'heli.fly', pose, landed }),
    bump: (speed) => bumped(speed),
  });
  /** In a seat of it: you, the camera, the mouse. */
  const ride = new Ride(player, ctx.camera);
  const landing = new LandingCheck(() => ctx.office.colliders, (c) => park().owns(c));
  let hud: HeliHud | null = null;
  /** The office's last word on where it is, as followed so far. */
  let heard = store.heliPose;
  /** The rotor's angle round (radians). */
  let angle = 0;
  /** When E last got you out (performance.now()). */
  let leftAt = -Infinity;
  /** Who's aboard, by id, and who else is on your floor (refreshed as the store says, so a step looks nothing up). */
  const crewById = new Map<string, HeliCrew>();
  const others: PeerInfo[] = [];
  /** Who's aboard or who's here changed: the figures in the seats are sorted out in the next frame (once features/peers has). */
  let crewChanged = true;
  const keys: HeliInput = { forward: 0, turn: 0, lift: 0, engine: false };
  let hudAt = 0;
  /** A word from the office about the flight, shown on the chip for a while (a snap), and when. */
  let note: { why: string; until: number } | null = null;
  let bumpedAt = 0;

  /** The street in the frame you're in: under your floor, or roofDrop below the roof's deck. */
  const street = () => (ctx.upTop() ? -roofDrop(deps.roofFloors()) : player.street);
  /** Where it's drawn: your own flight at the controls, else the office's word. */
  const drawn = (): HeliPose => (pilot.active ? pilot.drawn : follow.pose);
  const spinning = () => (pilot.active ? pilot.drawn.spin : follow.spin);
  const speed = () => (pilot.active ? pilot.speed : follow.speed);
  /** Down (parked or landed): at the controls, once the office has it down too. */
  const isDown = () => store.heli.landed && (!pilot.active || pilot.flight.landed);

  // ---- What it flies in -------------------------------------------------------------------------------

  /** The pilot's world: what's solid (the tower as tall as the roof is, the plots), the ground, and where it may land. */
  const world: FlyWorld = { solids: [], terrain: heliTerrain, terrainOver: heliTerrainOver, whyNotLand: (x, z, yaw) => landingWhy(x, z, yaw) };
  const viewWorld: ViewWorld = { terrain: heliTerrain, get solids() { return world.solids; } };
  function rebuild() {
    world.solids = heliSolids(deps.roofFloors(), store.street.cards, builtFloors().length);
  }
  store.on('street', rebuild);
  store.on('floors', rebuild);
  rebuild();

  /**
   * Why it may not set down at (x, z) turned `yaw`: where the street says it can't (shared/heli-world.ts),
   * where the office refused it a moment ago, and, down on a floor, anyone on yours under it or anything
   * standing in the way there.
   */
  function landingWhy(x: number, z: number, yaw: number): string | null {
    const now = performance.now();
    const why = whyNotLand(x, z, yaw, store.street.cards) ?? pilot.refusedHere(x, z, now);
    if (why || ctx.upTop()) return why;
    const s = player.street;
    for (let i = 0; i < others.length; i++) {
      const p = others[i];
      if (!crewById.has(p.id) && underneath(p.x, p.y, p.z, x, z, s)) return "Someone's underneath";
    }
    return landing.why(x, z, yaw, heliTerrain(x, z), s, now);
  }

  // ---- Getting in and out -----------------------------------------------------------------------------

  /** The seat you'd get: at the controls if you're a street admin and nobody's there, else a passenger's if one's free. */
  function freeSeat(): HeliSeat | null {
    const crew = store.heli.crew;
    if (store.streetAdmin() && !crew.some((c) => c.seat === 'pilot')) return 'pilot';
    return crew.filter((c) => c.seat === 'passenger').length < HELI.seats.length - 1 ? 'passenger' : null;
  }

  /** E at a door: in, if it's down and there's a seat. The office says yes (`heli`), and you take your seat then. */
  function board() {
    if (ride.active || ctx.trip() || ctx.activities.running('climber') || ctx.upTop()) return;
    if (!store.heli.landed) return toast("🚁 Friday One is in the air: wait till it's down", 'warn');
    if (ctx.carrying()) return toast('🗂️ Your hands are full: put the card back first (Q)', 'warn');
    if (ctx.holdingBall()) return toast('🏀 Put the ball down first (Q)', 'warn');
    const seat = freeSeat();
    if (!seat) return toast('🚁 Friday One is full', 'warn');
    if (doorDistance(drawn(), player.pos) > HELI.reach) return toast('🚁 Walk up to one of its doors', 'warn');
    leftAt = -Infinity;
    ctx.net.send({ t: 'heli.board', seat });
  }

  /** The office has you aboard (`c`): into your seat, and it has hold of you. */
  function takeSeat(c: HeliCrew) {
    if (player.seat) deps.standUp();
    ctx.activities.stopAll('start');
    deps.stopWalking();
    if (c.seat === 'pilot') pilot.start(follow.pose, store.heli.landed);
    ride.enter(c, riding);
    ctx.me.sit(SEAT_HIPS);
    (hud ??= new HeliHud($('hud'))).show(true);
    hudAt = 0;
    door();
    ctx.hint.invalidate();
  }

  /** Each frame aboard (the player's rig): fly it, at the controls, and sit where it's got to. */
  function riding(dt: number) {
    if (pilot.active) {
      keys.forward = (player.holding('KeyW', 'ArrowUp') ? 1 : 0) - (player.holding('KeyS', 'ArrowDown') ? 1 : 0);
      keys.turn = (player.holding('KeyA', 'ArrowLeft') ? 1 : 0) - (player.holding('KeyD', 'ArrowRight') ? 1 : 0);
      keys.lift = (player.holding('Space') ? 1 : 0) - (player.holding('ShiftLeft', 'ShiftRight') ? 1 : 0);
      pilot.update(dt, keys, world, performance.now());
    }
    ride.sit(drawn(), street());
  }

  /** Lets go of your seat (`yaw` is the way it faces): the helicopter's yours no longer, the camera's yours again. */
  function letGo(yaw: number) {
    if (pilot.active) {
      // From here it's drawn from the office's word, which starts where your flight left it.
      follow.reset(pilot.flight.pose);
      pilot.stop();
    }
    ride.leave(yaw);
    ctx.me.sit(null);
    hud?.show(false);
    note = null;
    ctx.hint.invalidate();
  }

  /** E aboard, once it's down: out beside your door. */
  function getOut() {
    if (!ride.active) return;
    const at = wayOut();
    ctx.net.send({ t: 'heli.leave' });
    leftAt = performance.now();
    letGo(drawn().yaw);
    if (at) {
      player.pos.set(at.x, at.y, at.z);
      player.vy = 0;
    }
    door();
  }

  /** The office has you out (it flew itself home and landed, or you came back after a dropped connection): out at the door. */
  function dropped() {
    const at = wayOut();
    letGo(drawn().yaw);
    if (at) player.pos.set(at.x, at.y, at.z);
  }

  /** A door shutting, by the cabin. */
  function door() {
    const p = drawn();
    ctx.sound.carDoor({ x: p.x, y: street() + p.h + 1, z: p.z });
  }

  /** Aboard, where you'd stand once out of it (see spotHere in core/place.ts): beside its door, on the ground under it. */
  function wayOut(): { x: number; y: number; z: number } | undefined {
    if (!ride.active) return undefined;
    const pose = drawn();
    const base = street();
    // Down, on what it's standing on; in the air (a reload mid-flight), on whatever's under it.
    const ground = isDown() ? base + pose.h : Math.max(base + heliTerrain(pose.x, pose.z), groundAt(player.colliders, pose.x, pose.z, base + pose.h));
    return ride.wayOut(pose, ground, (x, z, y) => player.fits(x, z, y));
  }

  ctx.interactions.define('heli', {
    reach: HELI.reach,
    hint: () => {
      const crew = store.heli.crew;
      const flying = crew.find((c) => c.seat === 'pilot')?.name;
      const seat = freeSeat();
      const k = `${flying ?? ''}|${seat ?? ''}|${crew.length}`;
      const title = hintTitle('🚁 Friday One');
      const who = flying ? `${clip(flying, 20)} is at the controls` : 'street admins fly it';
      if (seat === 'pilot') return { k, parts: [title, aside(crew.length ? `${crew.length} aboard` : 'on its pad'), key('E', 'Fly it')] };
      if (seat === 'passenger') return { k, parts: [title, aside(who), key('E', 'Ride along')] };
      return { k, parts: [title, aside(`${who} · full`)] };
    },
    use: onE(() => board()),
  });
  // Its doors are what you use it by, wherever it is: while it's down, and you're not in it.
  const none: Interactable[] = [];
  ctx.usables.add({ usable: () => (ride.active || ctx.upTop() ? none : park().doors) });

  ctx.activities.add({
    id: 'heli',
    active: () => ride.active,
    // Off somewhere else: out at the door if it's down. In the air there's no getting out, so put
    // somewhere on this floor (a desk, over to someone) you fly on; off to another floor, you leave it
    // (the office takes you off it as you go, and a pilot gone sends it flying itself home).
    stop: (why) => {
      if (why === 'start') return;
      if (isDown()) getOut();
      else if (why === 'trip' || why === 'taken') {
        leftAt = performance.now();
        letGo(drawn().yaw);
      }
    },
    // Aboard, E gets you out, C switches the view; nothing else is in reach (nor the office builder, nor a
    // picture to hang). W A S D, Space and Shift fly it (see riding).
    key: (e) => {
      if (e.code !== 'KeyE' && e.code !== 'KeyC' && e.code !== 'KeyF' && e.code !== 'KeyU' && !(e.code in DESK_KEYS)) return false;
      if (e.repeat) return true;
      if (e.code === 'KeyE') {
        if (isDown()) getOut();
        else toast("🚁 Wait till it's down to get out", 'warn');
      } else if (e.code === 'KeyC') {
        ride.switchView();
        ctx.hint.invalidate();
      }
      return true;
    },
    hint: (el) => renderHint(el),
    takesCamera: true,
    hidesHands: true,
  });

  // The wheel pulls the chase view in or out.
  ctx.canvas.addEventListener(
    'wheel',
    (e) => {
      if (ride.active && ride.cam.view === 'chase') ride.cam.zoom(e.deltaY * 0.012);
    },
    { passive: true },
  );

  // ---- The office's word ------------------------------------------------------------------------------

  // Who's aboard: you into your seat when the office has you there, and out when it lets you go.
  store.on('heli', () => {
    crewById.clear();
    for (const c of store.heli.crew) crewById.set(c.id, c);
    crewChanged = true;
    const mine = crewById.get(store.you);
    if (mine && !ride.active && performance.now() - leftAt > LEAVING) takeSeat(mine);
    else if (!mine && ride.active) dropped();
    ctx.hint.invalidate();
  });
  store.on('peers', () => {
    others.length = 0;
    for (const p of store.peers.values()) if (p.id !== store.you && !p.lite && store.onMyFloor(p)) others.push(p);
    crewChanged = true;
  });
  // The office wouldn't take where you said it was: back to where it was last good.
  ctx.messages.on('heli.snap', (m) => {
    if (!pilot.active) return;
    const now = performance.now();
    const landing = pilot.snap(m.pose, m.landed, m.why, now);
    note = { why: m.why, until: now + (landing ? 4000 : 2500) };
    if (!landing) toast(`🚁 ${m.why}`, 'warn');
  });

  /** It hit something hard, flying it: a thunk, the view shaking, and a word. */
  function bumped(hit: number) {
    const p = pilot.drawn;
    ctx.sound.crash({ x: p.x, y: street() + p.h + 1.5, z: p.z }, hit);
    ctx.shake(Math.min(0.9, hit / 14));
    const now = performance.now();
    if (now - bumpedAt > 2000) toast('🚁 Mind the building!', 'warn');
    bumpedAt = now;
  }

  /** Who's aboard and not here to be seen as themselves: figures in the seats, and the pilot's tag. */
  function syncCrew() {
    crewChanged = false;
    // You're drawn as yourself wherever you are; everyone else is if they're here with you (features/peers).
    const here = (id: string) => id === store.you || !!deps.personOf(id);
    const peer = (id: string) => store.peers.get(id);
    park().crew.sync(store.heli.crew, here, peer);
    roof.crew?.sync(store.heli.crew, here, peer);
  }

  // ---- Each frame -------------------------------------------------------------------------------------

  // The office's word, smoothed, before anyone riding in it is sat in it (the pilot flies their own).
  ctx.ticks.add('vehicles', ({ dt }) => {
    const said = store.heliPose;
    if (said !== heard) {
      heard = said;
      follow.hear(said.pose, said.at, store.heli.landed);
    }
    follow.step(store.officeNow(), dt);
    // Parked with nobody at the controls, the rotor runs down; otherwise it turns as the pilot last said.
    follow.spinTo(store.heli.stage === 'parked' ? 0 : heard.pose.spin, dt);
  });

  // The rotor's downwash on you, flying low over you (not while it's down: anyone can walk up and get in).
  ctx.ticks.add('moved', ({ dt }) => {
    if (ride.active || ctx.upTop() || ctx.trip() || player.rig || player.seat || !player.grounded) return;
    const pose = drawn();
    if (Math.abs(pose.x - player.pos.x) > HELI.rotor * 2 || Math.abs(pose.z - player.pos.z) > HELI.rotor * 2) return;
    const push = washOver(player, pose, store.heli.landed, player.street, heliTerrain(player.pos.x, player.pos.z), dt);
    if (push > 0.8) ctx.shake(0.06 * push);
  });

  // It, where it's got to, on your floor's street and from the roof; and aboard, the camera and the chip.
  ctx.ticks.add('play', ({ dt, t }) => {
    if (crewChanged) syncCrew();
    const pose = drawn();
    const spin = spinning();
    angle = (angle + spin * ROTOR_TURNS * Math.PI * 2 * dt) % ROUND;
    const down = isDown();
    const up = ctx.upTop();
    const p = park();
    p.show(pose, angle, spin, t, down);
    if (!up) p.crew.place(pose, STREET_Y, dt, t);
    for (const d of p.doors) d.off = !down || ride.active || up;
    const built = roof.built;
    // As far over the roof city as Main Street is drawn from up there, so it sits on its pad's deck.
    roof.show(up, pose, ROOF_LIFT - roofDrop(deps.roofFloors()), angle, spin, t, dt);
    if (!built && roof.built) syncCrew();
    if (!ride.active) return;
    ride.look();
    ride.frame(pose, street(), dt, viewWorld, speed(), t);
    const now = performance.now();
    if (now - hudAt >= HUD_EVERY) {
      hudAt = now;
      renderHud(now);
    }
  });

  const rotor: RotorState = { at: { x: 0, y: 0, z: 0 }, spin: 0, speed: 0, aboard: false };
  const hub = { x: 0, h: 0, z: 0 };
  ctx.ticks.add('others', () => {
    // In the cockpit you're the camera: your own head would be in the way of it.
    if (ride.active && ride.cam.view === 'cockpit') ctx.me.root.visible = false;
    // The rotor, heard by everyone on every floor from where it is (and in the cabin, aboard).
    const spin = spinning();
    if (spin < 0.01 && !ride.active) return ctx.sound.setRotor(null);
    heliPoint(drawn(), 0, HELI.hub, 0, hub);
    rotor.at.x = hub.x;
    rotor.at.y = street() + hub.h;
    rotor.at.z = hub.z;
    rotor.spin = spin;
    rotor.speed = speed();
    rotor.aboard = ride.active;
    ctx.sound.setRotor(rotor);
  });

  // ---- The chip and the hint bar ----------------------------------------------------------------------

  function renderHud(now: number) {
    if (!hud) return;
    const pose = drawn();
    const crew = store.heli.crew;
    const at = crew.find((c) => c.seat === 'pilot');
    const role = pilot.active ? 'at the controls' : at ? `with ${clip(at.name, 18)} flying` : store.heli.stage === 'home' ? 'flying itself home' : 'nobody at the controls';
    if (note && now > note.until) note = null;
    // Low over somewhere it can't set down, the chip says why before you try.
    const low = pilot.active && !pilot.flight.landed && pose.h - groundUnder(pose, world) < LAND_HOLD + 1.5;
    const why = pilot.active ? (note?.why ?? pilot.why ?? (pilot.edge ? "That's the edge of town" : low ? landingWhy(pose.x, pose.z, pose.yaw) : null)) : null;
    const status = heliStatus({ landed: isDown(), home: store.heli.stage === 'home', speed: speed(), spin: spinning(), why, engine: pilot.engine });
    const riders = crew.filter((c) => c.seat === 'passenger' && c.id !== store.you).map((c) => clip(c.name, 16));
    hud.render({ role, height: pose.h, speed: speed(), yaw: pose.yaw, status, crew: riders });
  }

  /**
   * The hint bar's keys, by whether you're at the controls (and its engine's running), whether it's down
   * and which view you're in: each hint made the first time it's wanted, so drawing it every frame makes
   * nothing new.
   */
  const hints: { k: string; parts: () => (HTMLElement | string)[] }[] = [];
  function renderHint(el: HTMLElement) {
    const at = pilot.active;
    const running = at && pilot.engine;
    const down = isDown();
    const chase = ride.cam.view === 'chase';
    const i = (running ? 8 : 0) + (at ? 4 : 0) + (down ? 2 : 0) + (chase ? 1 : 0);
    const hint = (hints[i] ??= {
      k: `heli|${i}`,
      parts: () => {
        const view = key('C', chase ? 'Cockpit view' : 'Chase view');
        const out = down ? key('E', 'Get out') : aside('out once it’s down');
        if (!at) return [hintTitle('🚁 Riding along'), view, out];
        const space = !down ? 'Climb' : running ? 'Lift off' : 'Spin up and lift off';
        return [key('W S', 'Fly'), key('A D', 'Turn'), key('Space', space), key('Shift', 'Sink'), view, out];
      },
    });
    ctx.hint.draw(el, hint.k, hint.parts);
  }

  // ---- For everyone else --------------------------------------------------------------------------------

  /** Where each seat is, for rideOf to hand back (one each, kept). */
  const seats = HELI.seats.map(() => ({ x: 0, y: 0, z: 0, rotY: 0 }));
  const seatAt = { x: 0, h: 0, z: 0 };

  /** Where someone on your floor is sitting in Friday One, if they're aboard: in your floor's frame, facing its way. */
  function rideOf(id: string): { x: number; y: number; z: number; rotY: number } | undefined {
    const c = crewById.get(id);
    if (!c) return undefined;
    const pose = drawn();
    const s = HELI.seats[c.place] ?? HELI.seats[0];
    heliPoint(pose, s.x, s.y - SEAT_HIPS, s.z, seatAt);
    const r = seats[c.place] ?? seats[0];
    r.x = seatAt.x;
    r.y = street() + seatAt.h;
    r.z = seatAt.z;
    r.rotY = pose.yaw;
    return r;
  }

  return { rideOf, wayOut };
}
