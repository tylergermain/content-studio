import './race.css';
import { gridSlot } from '../../../shared/circuit';
import { RACE, ordinal, raceTime, standings, type Racer, type RaceView } from '../../../shared/race';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { h, toast } from '../../ui/dom';
import type { Driver } from './controller';

// Races round the circuit (shared/race.ts) as you see them: R at the wheel starts one, or joins the one
// lining up, and your car's set down on the grid behind the line; the lights, then your lap and place
// and everyone's order down the side; your finish, and the results when it's over. Everyone on the floor
// sees the order while one's on, and how to join while it's lining up.

/** How long GO! stays up after the lights go out (ms). */
const GO_MS = 1200;

export interface RaceControls {
  /** R at the wheel: start a race, or join the one lining up. */
  key(): void;
  /** Your car's held on the grid: the lights haven't gone out. */
  held(): boolean;
  /** The bots may go, and whether car `car`'s bot has finished. */
  go(): boolean;
  finished(car: number): boolean;
  /** You're racing now (laps of the loop aren't timed on their own meanwhile). */
  racing(): boolean;
  /** What the drive hint says of it: the R key's label, if it does anything now. */
  rKey(): string | null;
}

export function raceControls(ctx: Ctx, driver: Driver): RaceControls {
  const hud = h('div.race-hud', { 'aria-live': 'polite', hidden: true });
  const lights = h('div.race-lights', { hidden: true }, ...[0, 1, 2].map(() => h('span.race-light')));
  const board = h('ol.race-board');
  const head = h('div.race-head');
  const results = h('div.race-results', { hidden: true });
  hud.append(head, lights, board);
  document.body.append(hud, results);

  /** Milliseconds till the lights go out, now (negative once it's under way). */
  const startsIn = (r: RaceView) => r.startsIn - (performance.now() - store.raceAt);
  const mine = (r: RaceView | null) => r?.racers.find((x) => x.who === store.you);
  const name = (x: Racer) => (x.who === store.you ? 'You' : x.name);
  let placed = '';
  let raceId = '';
  let beeped = 99;
  let finishedSeen = '';
  let overSeen = '';
  let painted = '';

  // Lining up: your car to your place on the grid, as soon as you have one (and again if it changes).
  store.on('race', () => {
    const r = store.race;
    const me = mine(r);
    if (!r || !me || r.over || me.out || startsIn(r) <= 0 || driver.car !== me.car || !driver.driving) return;
    const key = `${r.id}:${me.slot}`;
    if (key === placed) return;
    placed = key;
    driver.teleport(gridSlot(me.slot));
  });

  function paint() {
    const r = store.race;
    if (!r) {
      hud.hidden = true;
      return;
    }
    if (r.id !== raceId) {
      raceId = r.id;
      beeped = 99;
    }
    const left = startsIn(r);
    const me = mine(r);
    const order = left > 0 ? [...r.racers].sort((a, b) => a.slot - b.slot) : standings(r.racers);
    // The lights: three reds one by one over the last three seconds, out for GO.
    const lit = left > 0 && left <= RACE.lights ? Math.min(3, 3 - Math.ceil(left / 1000) + 1) : 0;
    const go = left <= 0 && left > -GO_MS;
    const secs = Math.ceil(left / 1000);
    if (left > 0 && left <= RACE.lights && secs < beeped) {
      beeped = secs;
      ctx.sound.arcade('land');
    }
    if (go && beeped > 0) {
      beeped = 0;
      ctx.sound.arcade('clear');
    }
    let line: string;
    if (r.over) line = '\u{1f3c1} The race is over';
    else if (left > RACE.lights) line = me ? `\u{1f3c1} Lining up: the lights in ${secs - 3}s` : `\u{1f3c1} A race is lining up: get behind a wheel and press R to join (${secs - 3}s)`;
    else if (left > 0) line = '\u{1f6a6} Get ready…';
    else if (go) line = 'GO!';
    else if (me?.time !== undefined) line = `\u{1f3c1} You finished ${ordinal(me.place ?? 0)} · ${raceTime(me.time)}`;
    else if (me && !me.out) {
      const place = standings(r.racers).indexOf(me) + 1;
      line = `Lap ${Math.min(r.laps, Math.max(1, me.lap + 1))}/${r.laps} · ${ordinal(place)} of ${r.racers.length} · ${raceTime(-left)}`;
    } else line = `\u{1f3c1} Race on · ${raceTime(-left)}`;
    const stamp = JSON.stringify([line, lit, go, order.map((x) => [x.car, x.time, x.out, x.lap])]);
    if (stamp !== painted) {
      painted = stamp;
      hud.hidden = false;
      head.textContent = line;
      head.classList.toggle('go', go);
      lights.hidden = !(left > 0 && left <= RACE.lights) && !go;
      [...lights.children].forEach((el, i) => {
        el.classList.toggle('red', !go && i < lit);
        el.classList.toggle('green', go);
      });
      board.replaceChildren(...order.map((x, i) => h('li', { 'data-me': String(x.who === store.you), 'data-out': String(!!x.out) },
        h('span.race-pos', {}, x.out ? '–' : String(i + 1)),
        h('span.race-name', {}, name(x)),
        h('span.race-time', {}, x.time !== undefined ? raceTime(x.time) : x.out ? 'out' : left > 0 ? `grid ${x.slot + 1}` : `lap ${Math.min(r.laps, Math.max(1, x.lap + 1))}`))));
    }
    // Your finish, once.
    if (me?.time !== undefined && finishedSeen !== r.id) {
      finishedSeen = r.id;
      if (me.place === 1) ctx.sound.golf('cheer');
      else ctx.sound.arcade('clear');
      toast(`\u{1f3c1} You finished ${ordinal(me.place ?? 0)} in ${raceTime(me.time)}`, 'info');
    }
    // The results, once it's over.
    if (r.over && overSeen !== r.id) {
      overSeen = r.id;
      showResults(r);
    }
  }

  let resultsTimer = 0;
  function showResults(r: RaceView) {
    const order = standings(r.racers);
    const close = h('button.race-x', { type: 'button', 'aria-label': 'Close' }, '✕');
    close.addEventListener('click', () => (results.hidden = true));
    results.replaceChildren(close, h('strong', {}, '\u{1f3c6} Results'), h('ol', {}, ...order.map((x) => h('li', { 'data-me': String(x.who === store.you) },
      h('span.race-name', {}, name(x)),
      h('span.race-time', {}, x.time !== undefined ? raceTime(x.time) : 'did not finish')))));
    results.hidden = false;
    window.clearTimeout(resultsTimer);
    resultsTimer = window.setTimeout(() => (results.hidden = true), RACE.keepOver);
  }

  ctx.ticks.add('others', () => paint());

  return {
    key() {
      if (!driver.driving) return;
      const r = store.race;
      const me = mine(r);
      if (r && !r.over && startsIn(r) > 0) {
        if (me) return void toast('\u{1f3c1} You’re on the grid: wait for the lights', 'info');
        ctx.net.send({ t: 'race.join' });
        return;
      }
      if (r && !r.over) return void toast('\u{1f3c1} There’s a race on: wait for the next one', 'warn');
      ctx.net.send({ t: 'race.start', laps: RACE.laps, bots: RACE.bots });
    },
    held() {
      const r = store.race;
      const me = mine(r);
      return !!r && !!me && !r.over && !me.out && startsIn(r) > 0;
    },
    go() {
      const r = store.race;
      return !!r && !r.over && startsIn(r) <= 0;
    },
    finished(car) {
      return store.race?.racers.find((x) => x.car === car)?.time !== undefined;
    },
    racing() {
      const r = store.race;
      const me = mine(r);
      return !!r && !!me && !r.over && !me.out && me.time === undefined;
    },
    rKey() {
      const r = store.race;
      if (!r || r.over) return 'Race';
      if (startsIn(r) > 0 && !mine(r)) return 'Join the race';
      return null;
    },
  };
}
