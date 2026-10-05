/**
 * Putt Street, the nine-hole mini golf course on Main Street (see shared/mainstreet.ts PUTT and
 * shared/minigolf/): E at the putter rack in the kiosk joins a group (or starts one), E at your ball
 * on your turn steps up to it, and the office rolls every putt and sends everyone the ball's path,
 * which every page plays on the office's clock. The course is world.ts (the puttCourse street fixture).
 */
import * as THREE from 'three';
import { PUTT } from '../../../shared/mainstreet';
import { HOLES, PAR } from '../../../shared/minigolf/course';
import type { PuttPlayer, PuttRound } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { DESK_KEYS } from '../../interaction';
import { store } from '../../state';
import { clip, toast } from '../../ui/dom';
import { IMPACT, type Person } from '../../world/character';
import type { Interactable } from '../../world/types';
import { PuttBalls } from './balls';
import { Putter } from './controller';
import { clockText, doneWith, nth, totalOf, turnOf } from './play';
import { shownRound } from './shown';
import { openRoundOver, puttCard, roundNews } from './ui';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    puttrack: true;
    puttball: true;
  }
}

export interface MiniGolfDeps {
  /** Up off whatever you're sitting on (see features/seating). */
  standUp(): void;
  /** Stops a walk over to someone, if you're on one. */
  stopWalking(): void;
  /** Someone on your floor, as you see them. */
  personOf(id: string): Person | undefined;
}

/** A second E at the rack within this long (ms) hands your putter back, mid-round. */
const QUIT_AGAIN = 4000;
/** Someone on your floor this close to their ball (m) on their turn is over it, putter in hand. */
const ADDRESS = 1.3;
/** Pressing E at your ball this soon after the office took a putt of yours does nothing (ms): it's on its way. */
const SENT = 2500;

export function installMiniGolf(ctx: Ctx, deps: MiniGolfDeps) {
  const course = ctx.office.puttStreet;
  const balls = new PuttBalls();
  course.group.add(balls.group);
  const card = puttCard();
  /** Where a sound goes, in your floor's frame: from the street frame, with the street that far below. */
  const world = new THREE.Vector3();

  /** The round you're in, and you in it, as of the office's latest word on the rounds (asked every frame). */
  let round: PuttRound | undefined;
  let self: PuttPlayer | undefined;
  const follow = () => {
    round = store.myRound();
    self = round?.players.find((p) => p.id === store.you);
  };
  follow();
  store.on('putt', follow);
  const mine = () => round;
  const me = () => self;
  /** Whether it's your turn in round `r`, with your ball out to putt (on hole `hole`, when given). */
  function myTurn(r = mine(), hole?: number): boolean {
    if (!r || r.stage !== 'playing' || r.waiting || (hole !== undefined && r.hole !== hole)) return false;
    const up = turnOf(r);
    return up?.id === store.you && !doneWith(up, r.hole);
  }

  // ---- Putting ------------------------------------------------------------------------------------
  let sentAt = -Infinity;
  const putter = new Putter(ctx.player, ctx.me, ctx.camera, {
    stroke: (yaw, power) => {
      const r = mine();
      if (!r) return;
      sentAt = performance.now();
      // A moment from now, for the putter's downswing to reach the ball (the office holds it to PUTT_RULES.leadMs).
      ctx.net.send({ t: 'putt.stroke', round: r.id, yaw, power, at: store.officeNow() + 90 });
    },
    ball: () => balls.ballAt(store.you),
    rolling: () => {
      const r = mine();
      const m = r ? balls.mine(r.id, store.officeNow()) : null;
      // Only a putt struck since you sent yours (an older one of yours doesn't count).
      return m && m.roll.startAt > store.officeNow() - (performance.now() - sentAt) - 1000 ? m : null;
    },
    stillUp: () => myTurn(mine(), putter.hole) && !!balls.ballAt(store.you),
    taken: () => me()?.taken ?? 0,
    street: () => ctx.player.street,
    done: () => ctx.hint.invalidate(),
  });
  course.group.add(putter.line);
  ctx.activities.add({
    id: 'putter',
    active: () => putter.active,
    stop: () => putter.stop(),
    // E or Esc steps away; Space putts (see Putter); nothing else is in reach, and no emotes mid-putt.
    key: (e) => {
      if (e.code === 'KeyE' || e.code === 'Escape') {
        putter.stop();
        return true;
      }
      return e.code === 'KeyF' || e.code === 'KeyG' || e.code in DESK_KEYS || /^(?:Digit|Numpad)[1-6]$/.test(e.code);
    },
    hint: (el) => renderPuttHint(el),
    takesCamera: true,
    hidesHands: true,
    // Both hands on the putter: no mug in them (see feelTheCoffee in core/loop.ts).
    bothHands: true,
  });
  ctx.windowOpened.add(() => putter.letGo());
  ctx.ticks.add('play', ({ dt }) => {
    if (putter.active) {
      // Pulled away (sat down, off up the ladder, into the elevator, up on the roof), or no longer up to putt.
      const away = !!ctx.trip() || ctx.activities.running('climber') || !!ctx.player.seat || ctx.upTop();
      if (away || (putter.doing !== 'watch' && !myTurn(mine(), putter.hole))) putter.stop();
    }
    balls.quiet = putter.active;
    putter.update(dt);
  });

  /** While you're over your ball: how to aim and putt, or what the ball's doing. */
  function renderPuttHint(el: HTMLElement) {
    const stage = putter.doing;
    const r = mine();
    const roll = stage === 'watch' && r ? balls.mine(r.id, store.officeNow()) : null;
    const how = !roll ? '' : !roll.over ? 'going' : roll.roll.holed ? 'holed' : roll.roll.out ? 'out' : roll.roll.moved ? 'moved' : 'still';
    ctx.hint.draw(el, `putt|${stage}|${how}`, () =>
      stage === 'charge'
        ? [hintTitle('⛳ Let go to putt'), aside('the meter runs up, then back down')]
        : stage === 'watch'
          ? [
              hintTitle(
                how === 'holed'
                  ? '⛳ In the cup!'
                  : how === 'out'
                    ? roll?.roll.out === 'water'
                      ? '⛳ In the water: a stroke, and back where you putted from'
                      : '⛳ Off the felt: a stroke, and back where you putted from'
                    : how === 'moved'
                      ? '⛳ Nobody can stand there: moved a club length'
                      : how === 'still'
                        ? '⛳ Stopped'
                        : '⛳ Rolling…',
              ),
              key('E', 'Step away'),
            ]
          : [key('Space', 'Hold to putt'), key('A D', 'Aim'), key('E', 'Step away')],
    );
  }

  // ---- Your ball: what you step up to on your turn ------------------------------------------------
  const ballIt: Interactable = { kind: 'puttball', x: 0, z: 0, y: 0, radius: 2.5, off: true };
  // Something to point at round your ball, much bigger than it and never drawn.
  const pick = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
  pick.userData.interact = ballIt;
  pick.visible = false;
  course.group.add(pick);
  const ballList = [ballIt];
  ctx.usables.add({ usable: () => (ballIt.off ? [] : ballList) });

  ctx.interactions.define('puttrack', {
    reach: 3,
    hint: () => rackHint(),
    use: onE(() => useRack()),
  });
  ctx.interactions.define('puttball', {
    reach: 3,
    hint: () => ballHint(),
    use: onE(() => stepUp()),
  });

  /** E at your ball: over it with the putter, if it's your turn and it's lying still. */
  function stepUp() {
    const r = mine();
    if (!r || putter.active) return;
    if (!myTurn(r)) return void toast(r.waiting ? '⛳ Waiting for the group ahead to finish the hole' : `⛳ It's ${clip(turnOf(r)?.name ?? 'someone else', 20)}'s turn`, 'warn');
    if (balls.rolling(r.id, store.officeNow()) || performance.now() - sentAt < SENT) return;
    const carrying = ctx.carrying();
    if (carrying) return void toast(`✋ Your hands are full: put #${carrying.issue} down first (Q)`, 'warn');
    if (ctx.player.seat) deps.standUp();
    ctx.activities.stopAll('start');
    deps.stopWalking();
    if (putter.start(r.hole)) ctx.hint.invalidate();
  }

  function ballHint() {
    const r = mine();
    const p = me();
    const title = hintTitle('⛳ Your ball');
    if (!r || !p) return { k: 'none', parts: [title] };
    if (!myTurn(r)) {
      const why = r.waiting ? 'waiting for the group ahead' : `${clip(turnOf(r)?.name ?? '', 18)}'s turn`;
      return { k: `wait|${why}`, parts: [title, aside(why)] };
    }
    const hole = HOLES[r.hole];
    const about = `hole ${hole.n}, par ${hole.par} · your ${nth(p.taken + 1)} stroke`;
    return { k: `up|${about}`, parts: [title, aside(about), key('E', 'Step up to it')] };
  }

  // ---- The rack: picking up a putter, teeing off, handing it back --------------------------------
  let quitAskedAt = -Infinity;
  function rackHint() {
    const r = mine();
    const title = hintTitle('⛳ Putt Street');
    if (!r || r.stage === 'over') return { k: 'free', parts: [title, aside(`nine holes, par ${PAR}`), key('E', 'Pick up a putter')] };
    if (r.stage === 'forming') {
      const left = `tees off in ${clockText(r.until - store.officeNow())}`;
      if (r.starter === store.you) {
        const n = r.players.length;
        return { k: `start|${n}|${left}`, parts: [title, aside(`${n} in your group · ${left}`), key('E', 'Tee off now')] };
      }
      return { k: `joined|${left}`, parts: [title, aside(`you're in · ${left}`), key('E', 'Hand your putter back')] };
    }
    return { k: `playing|${r.hole}`, parts: [title, aside(`you're on hole ${r.hole + 1}`), key('E', 'Hand your putter back')] };
  }

  function useRack() {
    const r = mine();
    if (!r || r.stage === 'over') return ctx.net.send({ t: 'putt.play' });
    if (r.stage === 'forming' && r.starter === store.you) return ctx.net.send({ t: 'putt.start', round: r.id });
    // Leaving a round takes a second E, so one by mistake doesn't lose your card.
    if (performance.now() - quitAskedAt > QUIT_AGAIN) {
      quitAskedAt = performance.now();
      return void toast('⛳ Press E again to hand your putter back and leave the round');
    }
    quitAskedAt = -Infinity;
    if (putter.active) putter.stop();
    ctx.net.send({ t: 'putt.quit', round: r.id });
  }

  // ---- Every frame: the balls, your ball's place to use, others over their balls -----------------
  /** Those on your floor you've given a putter to, while it's their turn and they're over their ball. */
  const putting = new Set<string>();
  ctx.ticks.add('others', () => {
    const rounds = store.puttRounds;
    balls.you = store.you;
    balls.update(store.officeNow(), rounds, store.puttRolls);
    // Your ball, to step up to on your turn.
    const r = mine();
    const at = r && myTurn(r) && !putter.active && !ctx.upTop() ? balls.ballAt(store.you) : null;
    ballIt.off = !at;
    pick.visible = !!at;
    if (at) {
      ballIt.x = at.x;
      ballIt.z = at.z;
      ballIt.y = ctx.player.street;
      pick.position.copy(at);
    }
    // Whoever's up on your floor, standing at their ball, has a putter in their hands.
    for (const id of putting) {
      if (overBall(id, rounds)) continue;
      deps.personOf(id)?.setGolf(false);
      putting.delete(id);
    }
    for (const round of rounds) {
      const up = turnOf(round);
      if (!up || up.id === store.you || !overBall(up.id, rounds)) continue;
      putting.add(up.id);
      // Again every frame: the peers' own sync puts a club away whenever they change (features/peers).
      deps.personOf(up.id)?.setGolf(true, 'putter');
    }
  });
  /** Whether player `id` is on your floor, up in their round, and standing at their ball. */
  function overBall(id: string, rounds: readonly PuttRound[]): boolean {
    const peer = store.peers.get(id);
    const person = deps.personOf(id);
    const ball = balls.ballAt(id);
    if (!peer || !person || !ball || peer.golfing || !store.onMyFloor(peer) || ctx.upTop()) return false;
    let up = false;
    for (const r of rounds) if (turnOf(r)?.id === id) up = true;
    if (!up) return false;
    const p = person.root.position;
    return Math.hypot(p.x - ball.x, p.z - ball.z) < ADDRESS && Math.abs(p.y - (ctx.player.street + ball.y)) < 1;
  }
  // Their putt: the putter back and through, meeting the ball as the office strikes it.
  const swung = new WeakSet<object>();
  store.on('puttRolled', () => {
    for (const roll of store.puttRolls.values()) {
      if (roll.id === store.you || !putting.has(roll.id) || swung.has(roll)) continue;
      swung.add(roll);
      const person = deps.personOf(roll.id);
      if (!person) continue;
      person.golfBack(0.15 + 0.2 * roll.power);
      setTimeout(() => person.golfHit(), Math.max(0, roll.startAt - IMPACT * 1000 - store.officeNow()));
    }
  });

  // The sounds of every putt, from where the ball is (none from the roof, high over it all).
  balls.onEvent = (kind, at, amount) => {
    if (ctx.upTop()) return;
    ctx.sound.putt(kind, world.set(at.x, ctx.player.street + at.y, at.z), amount);
  };

  // ---- The HUD's scorecard, turns, the end of a round and the records ------------------------------
  ctx.ticks.add('hud', () => {
    const now = store.officeNow();
    card.show(shownRound(mine(), now), store.you, now);
  });
  /** Your round as it was last time, to tell what's changed: whose turn, and whether it's over. */
  let last: { id: string; hole: number; stage: PuttRound['stage']; up: boolean } | null = null;
  /** When you first saw yourself in the round you're in (the office's clock): what it set on the record board is from then on. */
  let joinedAt = 0;
  store.on('putt', () => {
    const r = mine();
    if (!r) {
      last = null;
      return;
    }
    if (last?.id !== r.id) joinedAt = store.officeNow();
    const up = myTurn(r);
    if (up && !(last?.id === r.id && last.up && last.hole === r.hole)) toast(`⛳ Your turn on hole ${r.hole + 1}`);
    if (r.stage === 'over' && last?.id === r.id && last.stage !== 'over') roundOver(r);
    last = { id: r.id, hole: r.hole, stage: r.stage, up };
  });

  function roundOver(r: PuttRound) {
    if (putter.active) putter.stop();
    const p = r.players.find((x) => x.id === store.you);
    openRoundOver(r, store.you, roundNews(store.puttBoard, p?.name ?? store.profile.name, p ? totalOf(p) : 0, joinedAt));
  }

  // A new course record or a hole in one: confetti where it happened (the office toasts it to everyone).
  let cheeredAt = 0;
  store.on('puttBoard', () => {
    const news = store.puttLatest;
    if (!news || news.at === cheeredAt || ctx.upTop()) return;
    cheeredAt = news.at;
    if (news.what === 'record') ctx.confetti.burst(PUTT.record.x, ctx.player.street + 2.6, PUTT.record.z, 260, 1.3);
    else if (news.what === 'ace' && news.hole !== undefined && HOLES[news.hole]) {
      const cup = HOLES[news.hole].cup;
      ctx.confetti.burst(cup.x, ctx.player.street + 0.8, cup.z, 220, 1.1);
    }
  });

  // Off to another floor: the putts there are the same ones, but the people over their balls aren't.
  store.on('floor', () => {
    for (const id of putting) deps.personOf(id)?.setGolf(false);
    putting.clear();
  });

  /** Whether you're in a round on Putt Street. */
  const inRound = () => !!store.myRound();
  return { inRound, putter, balls };
}
