/**
 * Putt Street's windows on the HUD: the compact scorecard at the top left while you're in a round
 * (every player's strokes hole by hole, par under the holes, the hole being played and whose turn it
 * is), and the Round-over window at the end, with the whole card and what you did.
 */
import { HOLES, PAR } from '../../../shared/minigolf/course';
import { PUTT_RULES, type PuttBoard, type PuttPlayer, type PuttRound } from '../../../shared/protocol';
import { $, clip, h, openModal, type Modal } from '../../ui/dom';
import { clockText, doneWith, highlights, parText, toPar, totalOf } from './play';
import './ui.css';

const PARS = HOLES.map((hole) => hole.par);

/** The card: a row per player, holes 1..9 and the total across; `now` is the hole being played (or -1), `up` whose turn. */
function cardTable(r: PuttRound, now: number, up: string | null, you: string, best = Infinity): HTMLElement {
  const head = h('tr', {}, h('th.who', {}, 'Hole'), ...PARS.map((_, i) => h('th', { class: i === now ? 'now' : '' }, String(i + 1))), h('th.tot', {}, 'Tot'));
  const par = h('tr.par', {}, h('td.who', {}, 'Par'), ...PARS.map((p, i) => h('td', { class: i === now ? 'now' : '' }, String(p))), h('td.tot', {}, String(PAR)));
  const rows = r.players.map((p) => {
    const classes = [p.id === up ? 'up' : '', p.id === you ? 'mine' : '', totalOf(p) === best && r.players.every((o) => doneWith(o, PARS.length - 1)) ? 'win' : ''].filter(Boolean).join(' ');
    return h(
      'tr',
      { class: classes },
      h('td.who', {}, h('span.dot', { style: `background:${p.color}` }), clip(p.name, 16)),
      ...p.strokes.map((s, i) => {
        const cls = [i === now ? 'now' : '', s === 1 ? 'ace' : typeof s === 'number' && s < PARS[i] ? 'under' : ''].filter(Boolean).join(' ');
        // The hole being played: strokes so far, while they're still on it.
        const text = typeof s === 'number' ? String(s) : i === now && p.taken > 0 ? `${p.taken}·` : '';
        return h('td', { class: cls }, text);
      }),
      h('td.tot', {}, scoreText(p)),
    );
  });
  return h('table.putt-table', {}, h('thead', {}, head, par), h('tbody', {}, ...rows));
}

/** A player's total so far, and how it stands against par: "12 (+1)". */
function scoreText(p: PuttPlayer): string {
  const total = totalOf(p);
  return total ? `${total} (${parText(toPar(p, PARS))})` : '–';
}

export interface PuttCard {
  /** Shows the card for round `r` (yours), or hides it; `now` is the office's clock. */
  show(r: PuttRound | undefined, you: string, now: number): void;
}

/** The scorecard at the top left of the HUD, while you're in a round. It takes no clicks or keys. */
export function puttCard(): PuttCard {
  const el = h('div.putt-card.panel.hidden', { 'aria-label': 'Putt Street scorecard' });
  $('hud').append(el);
  let shown = '';
  // What it last showed: the round (a new one comes with every change) and the second its clocks were on.
  let lastRound: PuttRound | undefined;
  let lastSecond = -1;
  return {
    show(r, you, now) {
      if (!r || r.stage === 'over') {
        if (!el.classList.contains('hidden')) el.classList.add('hidden');
        shown = '';
        lastRound = undefined;
        return;
      }
      const second = Math.floor(now / 1000);
      if (r === lastRound && second === lastSecond) return;
      lastRound = r;
      lastSecond = second;
      const up = r.stage === 'playing' ? (r.players[r.turn] ?? null) : null;
      const mine = up?.id === you;
      const left = r.until - now;
      // What's going on, and the clock it's on: teeing off by itself, or the turn picked up.
      const what =
        r.stage === 'forming'
          ? r.starter === you
            ? 'Your group · E at the rack to tee off'
            : `${clip(r.players.find((p) => p.id === r.starter)?.name ?? 'Your group', 14)}'s group is forming`
          : r.waiting
            ? `Hole ${r.hole + 1} · waiting for the group ahead`
            : mine
              ? `Hole ${r.hole + 1} · your turn`
              : `Hole ${r.hole + 1} · ${clip(up?.name ?? '', 14)} to putt`;
      const clock = r.stage === 'forming' ? `tees off in ${clockText(left)}` : !r.waiting && !r.rolling && left > 0 ? clockText(left) : '';
      const key = JSON.stringify([r.players.map((p) => [p.id, p.name, p.color, p.strokes, p.taken]), r.hole, r.turn, r.stage, what, clock]);
      el.classList.remove('hidden');
      if (key === shown) return;
      shown = key;
      const late = r.stage === 'playing' && left < (PUTT_RULES.idleS - PUTT_RULES.warnS) * 1000;
      el.replaceChildren(
        h('div.putt-card-head', {}, h('span', {}, '⛳'), h('span', { class: mine ? 'putt-now' : '' }, what), clock ? h('span.putt-clock', { class: late ? 'late' : '' }, clock) : ''),
        cardTable(r, r.stage === 'playing' ? r.hole : -1, up?.id ?? null, you),
        r.stage === 'forming' ? h('div.putt-card-foot', {}, `${r.players.length} of ${PUTT_RULES.players} · anyone at the rack can join`) : '',
      );
    },
  };
}

/** What this round put on the record board, for the Round-over window: a course record, and the holes it's the best ever on (1..9). */
export interface RoundNews {
  record: boolean;
  bests: number[];
}

/** What the records say a round of `name`'s did, going round in `total`, given the board as it is now and when the round began (office ms). */
export function roundNews(board: PuttBoard, name: string, total: number, since: number): RoundNews {
  return {
    record: !!board.record && board.record.name === name && board.record.total === total && board.record.at >= since,
    bests: board.best.flatMap((b, i) => (b && b.name === name && b.at >= since ? [i + 1] : [])),
  };
}

/** The Round-over window: everyone's card, your total against par, and what you did on the way round. */
export function openRoundOver(r: PuttRound, you: string, news: RoundNews): Modal {
  const me = r.players.find((p) => p.id === you);
  const totals = r.players.map(totalOf);
  const best = Math.min(...totals);
  const pills: HTMLElement[] = [];
  if (news.record) pills.push(h('span.pill.record', {}, '🏆 New course record!'));
  if (me) {
    for (const hl of highlights(me, PARS)) {
      const holes = hl.holes.join(', ');
      const text = hl.name === 'Hole in one' ? `⭐ Ace on ${hl.holes.length > 1 ? 'holes' : 'hole'} ${holes}` : `${hl.name}${hl.holes.length > 1 ? 's' : ''} on ${holes}`;
      pills.push(h('span.pill.good', {}, text));
    }
    if (news.bests.length) pills.push(h('span.pill.good', {}, `Best ever on ${news.bests.length > 1 ? 'holes' : 'hole'} ${news.bests.join(', ')}`));
  }
  const winners = r.players.filter((p) => totalOf(p) === best);
  const headline = !me
    ? `${winners.map((w) => w.name).join(' and ')} won`
    : r.players.length < 2
      ? `You went round in`
      : winners.some((w) => w.id === you)
        ? winners.length > 1
          ? 'You tied for first with'
          : 'You won with'
        : 'You went round in';
  const el = h(
    'div.modal.putt-over',
    { role: 'dialog', 'aria-label': 'Round over' },
    h('header', {}, h('h2', {}, '⛳ Round over')),
    h(
      'div.body',
      {},
      me ? h('p.putt-total', {}, `${headline} `, h('b', {}, String(totalOf(me))), ` (${parText(toPar(me, PARS))} against par ${PAR})`) : h('p.putt-total', {}, headline),
      pills.length ? h('div.putt-news', {}, ...pills) : '',
      cardTable(r, -1, null, you, best),
    ),
    h('footer', {}, h('span.grow', {}, 'The record board by the gate keeps the course record, the best on each hole and the holes in one. Pick up a putter at the rack to go again.')),
  );
  return openModal(el, { doing: '⛳ reading a Putt Street scorecard' });
}
