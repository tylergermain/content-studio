/**
 * Golf off the balcony: the tees (a club out, a swing, the camera following the ball), everyone's balls
 * in the air or lying where they stopped, and your records, kept in this browser. A floor with two
 * tees has two bays (see shared/tees.ts): one person on each, both swinging at once.
 */
import { GOLF_HOLE } from '../../../shared/layout';
import { BISTRO_SEATS, TEES, cleanBay } from '../../../shared/tees';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { Golfer } from './controller';
import { DESK_KEYS } from '../../interaction';
import { store } from '../../state';
import { clip, h, toast } from '../../ui/dom';
import { BACKSWING_TIME, IMPACT, type Person } from '../../world/character';
import { pinDistance, teeBall } from './tee';
import { GolfBalls, fly, pinText, type Flight, type Hit, type Shot } from './world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    golf: true;
  }
}

export interface GolfDeps {
  /** Up off whatever you're sitting on (see features/seating). */
  standUp(): void;
  /** Stops a walk over to someone, if you're on one. */
  stopWalking(): void;
  /** Puts your cigarette out, if you're on a smoke break (see features/smoke). */
  stopSmoking(): void;
  /** Someone else on your floor, as you see them. */
  personOf(id: string): Person | undefined;
}

export function installGolf(ctx: Ctx, deps: GolfDeps) {
  // Everyone's balls, in the air or lying where they stopped.
  const balls = new GolfBalls();
  ctx.scene.add(balls.group);
  /** Your closest shot to the pin so far (meters) and how many you've holed in one, kept in this browser. */
  const GOLF_KEY = 'agent-office.golf';
  function golfRecord(): { best: number | null; holes: number } {
    try {
      const r = JSON.parse(localStorage.getItem(GOLF_KEY) ?? '{}') as { best?: unknown; holes?: unknown };
      return { best: typeof r.best === 'number' ? r.best : null, holes: typeof r.holes === 'number' ? r.holes : 0 };
    } catch {
      return { best: null, holes: 0 };
    }
  }
  function saveGolfRecord(r: { best: number | null; holes: number }) {
    try {
      localStorage.setItem(GOLF_KEY, JSON.stringify(r));
    } catch {
      // private window: it's only for this visit then
    }
  }
  /** Until when (performance.now()) each bay's tee has no ball on it: someone just hit it, and is teeing up the next. */
  const teeEmptyUntil = TEES.map(() => 0);
  /** A shot off bay `bay`'s tee on this floor, by you or someone else: where it goes is worked out the same way everywhere. */
  function shotHere(shot: Shot, bay: number): Flight {
    return fly(shot, ctx.player.street, ctx.office.stack.state.index, bay);
  }
  const golf = new Golfer(ctx.player, ctx.me, ctx.camera, {
    holding: (on, bay) => ctx.net.send({ t: 'act', golf: on, bay }),
    hit: (shot, bay) => {
      // The office knows which bay you're on (see `holding`), and says so with the shot.
      ctx.net.send({ t: 'golf', ...shot });
      balls.launch(shotHere(shot, bay), store.profile.name, true);
      ctx.sound.golf('hit');
    },
    ball: () => balls.mine,
    street: () => ctx.player.street,
    done: () => ctx.hint.invalidate(),
  });
  ctx.activities.add({
    id: 'golf',
    active: () => golf.active,
    // The club goes back for anything but the office moving you off your floor (takenAway leaves it out).
    stop: (why) => {
      if (why !== 'taken') golf.stop();
    },
    // At the golf tee, E puts the club back (Space swings, see Golfer); nothing else is in reach, and no emotes mid-swing.
    key: (e) => {
      if (e.code !== 'KeyF' && e.code !== 'KeyG' && !(e.code in DESK_KEYS) && !/^(?:Digit|Numpad)[1-6]$/.test(e.code)) return false;
      if (e.code === 'KeyE') golf.stop();
      return true;
    },
    hint: (el) => renderGolfHint(el),
    takesCamera: true,
    hidesHands: true,
    // Both hands are on the club at the tee: no mug in them (see feelTheCoffee in core/loop.ts).
    bothHands: true,
  });
  ctx.ticks.add('play', ({ dt }) => {
    // Pulled away from the tee (sat down, off up the ladder, into the elevator): the club goes back.
    if (golf.active && (ctx.trip() || ctx.activities.running('hanger') || ctx.activities.running('climber') || ctx.player.seat || ctx.upTop())) golf.stop();
    golf.update(dt);
  });
  // The balls in the air (none up on the roof, where the darts are), and the next one on each tee.
  ctx.ticks.add('play', ({ dt, now }) => {
    balls.update(dt);
    ctx.office.tee.bays.forEach((b, i) => (b.ball.visible = !(golf.doing === 'watch' && golf.bay === i) && now > teeEmptyUntil[i]));
  });
  // The floor's tees changed under you (the office builder, or another floor): no swinging on a bay
  // that's been put away, and no sitting on a stool that has (the second bay stands where they were).
  ctx.office.room.on(() => {
    if (golf.active && golf.bay >= ctx.office.tee.out()) golf.stop();
    if (ctx.office.tee.out() > 1 && ctx.player.seat && BISTRO_SEATS.includes(ctx.player.seat.seatId)) deps.standUp();
  });
  balls.onHit = (hit: Hit, mine: boolean) => {
    // Your own ball's heard wherever it lands (the camera's following it); anyone else's from where it is.
    const at = mine ? undefined : hit.at;
    if (hit.kind === 'cup') ctx.sound.golf('cup', at);
    else if (hit.kind === 'bounce') ctx.sound.golf(hit.lie === 'sand' || hit.lie === 'rough' ? 'thud' : 'bounce', at, hit.speed);
    else ctx.sound.golf(hit.kind, at, hit.speed);
  };
  balls.onRest = (f: Flight, who: string, mine: boolean) => {
    if (f.holed) {
      ctx.confetti.burst(GOLF_HOLE.x, ctx.player.street + 1.2, GOLF_HOLE.z, 260, 1.4);
      ctx.sound.golf('cheer');
    }
    if (!mine) {
      if (f.holed) toast(`🏆 ${who} got a hole in one!`);
      return;
    }
    const rec = golfRecord();
    if (f.holed) {
      rec.holes++;
      toast(rec.holes === 1 ? '🏆 HOLE IN ONE!' : `🏆 HOLE IN ONE! That's ${rec.holes}`);
    } else if (Number.isFinite(f.fromPin) && (rec.best === null || f.fromPin < rec.best)) {
      if (rec.best !== null) toast(`⛳ ${pinText(f.fromPin)} from the pin — your best yet!`);
      rec.best = f.fromPin;
    } else return;
    saveGolfRecord(rec);
  };

  // Which bay everyone else is on comes with their club (peer.act); features/peers keeps `golfing` itself.
  ctx.messages.on('peer.act', (msg) => {
    const p = msg.golf === undefined ? undefined : store.peers.get(msg.id);
    if (!p) return;
    const bay = msg.golf ? cleanBay(msg.bay) : 0;
    if (bay) p.golfBay = bay;
    else delete p.golfBay;
  });

  /** Who's on bay `bay`'s tee on this floor already, if anyone: someone on the other bay doesn't take this one. */
  function teeTaken(bay: number): string | null {
    for (const p of store.peers.values()) if (p.id !== store.you && p.golfing && (p.golfBay ?? 0) === bay && store.onMyFloor(p)) return p.name;
    return null;
  }

  /** Who's on another bay of this floor's, to tee off beside. */
  function beside(bay: number): string | null {
    for (let b = 0; b < ctx.office.tee.out(); b++) {
      const other = b === bay ? null : teeTaken(b);
      if (other) return other;
    }
    return null;
  }

  /** Another bay of this floor's with nobody on it, if there is one. */
  function freeBay(bay: number): number | null {
    for (let b = 0; b < ctx.office.tee.out(); b++) if (b !== bay && !teeTaken(b)) return b;
    return null;
  }

  /** E at a tee: take a club out and step up to that bay's ball. */
  function teeOff(bay: number) {
    if (golf.active || ctx.trip() || ctx.activities.running('climber') || bay >= ctx.office.tee.out()) return;
    const other = teeTaken(bay);
    // With a second bay out and nobody on it, that's where to go.
    const free = other ? freeBay(bay) : null;
    if (other) return toast(free !== null ? `🏌️ ${other} is on this tee — tee ${free + 1} is free` : `🏌️ ${other} is on the tee — wait your turn`, 'warn');
    const carrying = ctx.carrying();
    if (carrying) return toast(`✋ Your hands are full: put #${carrying.issue} down first (Q)`, 'warn');
    if (ctx.player.seat) deps.standUp();
    ctx.activities.stopAll('start');
    deps.stopWalking();
    deps.stopSmoking();
    golf.start(bay);
  }

  ctx.interactions.define('golf', {
    reach: 3.5,
    hint: (it) => {
      const bay = it.bay ?? 0;
      // On a floor with two, each tee has its number.
      const name = ctx.office.tee.out() > 1 ? `⛳ Golf tee ${bay + 1}` : '⛳ Golf tee';
      const other = teeTaken(bay);
      if (other) {
        const free = freeBay(bay);
        const taken = `🏌️ ${clip(other, 24)} is teeing off${free !== null ? ` · tee ${free + 1} is free` : ''}`;
        return { k: `taken|${name}|${taken}`, parts: [hintTitle(name), aside(taken)] };
      }
      const { best, holes } = golfRecord();
      const about = [holes ? `🏆 ${holes} hole${holes === 1 ? '' : 's'} in one` : '', best !== null ? `your best ${pinText(best)} from the pin` : `the pin's ${Math.round(pinDistance(bay))} m out`].filter(Boolean).join(' · ');
      const next = beside(bay);
      return { k: `${name}|${about}|${next ?? ''}`, parts: [hintTitle(name), aside(about), key('E', next ? `Tee off beside ${clip(next, 18)}` : 'Tee off')] };
    },
    use: onE((it) => teeOff(it.bay ?? 0)),
  });
  ctx.messages.on('golf', (msg) => theirShot(msg.id, { yaw: msg.yaw, loft: msg.loft, power: msg.power }, cleanBay(msg.bay)));
  /** Someone else on the floor hit one off bay `bay`: their swing, then their ball, off that tee. */
  function theirShot(id: string, shot: Shot, bay: number) {
    const p = store.peers.get(id);
    if (!p || !store.onMyFloor(p) || ctx.upTop()) return;
    deps.personOf(id)?.golfSwing(shot.power);
    const floor = store.floor;
    setTimeout(() => {
      if (store.floor !== floor || ctx.upTop()) return;
      balls.launch(shotHere(shot, bay), p.name, false);
      teeEmptyUntil[bay] = performance.now() + 1800;
      ctx.sound.golf('hit', teeBall(bay));
    }, (BACKSWING_TIME + IMPACT) * 1000);
  }

  /** At the golf tee: how to aim and swing, or how to get back to it while the ball's out there. */
  function renderGolfHint(el: HTMLElement) {
    const title = (text: string) => h('span.title', {}, text);
    const stage = golf.doing;
    ctx.hint.draw(el, `golf|${stage}`, () =>
      stage === 'watch'
        ? [title('⛳ Fore!'), key('Space', 'Back to the tee'), key('E', 'Done')]
        : stage === 'charge' || stage === 'swing'
          ? [title('⛳ Let go to hit it'), aside('the fuller the meter, the further it goes')]
          : [key('Space', 'Hold to swing'), key('A D', 'Aim'), key('W S', 'Loft'), key('E', 'Done')],
    );
  }

  return { golf, balls };
}
