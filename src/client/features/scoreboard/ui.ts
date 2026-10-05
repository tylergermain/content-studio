/**
 * The scoreboard's window (E at the board): the whole table of longest shots and when each went in,
 * the PIG winners, the game on now, and who at the court to play PIG with. And the invite you get.
 */
import { inFeet, metres, ordinal } from '../../../shared/longshots';
import { scoreLine } from '../../../shared/pig';
import { store } from '../../state';
import { $, clip, h, openModal, timeAgo, type Modal } from '../../ui/dom';
import './ui.css';

/** Someone at the court with you, to play PIG with: `asked` if they've asked you. */
export interface Partner {
  id: string;
  name: string;
  asked: boolean;
}

export interface BoardWindowDeps {
  partners(): Partner[];
  invite(id: string): void;
  quit(): void;
}

/** How long a make stays picked out as the newest (ms). */
const NEWEST_FOR = 15_000;

export function openBoardWindow(deps: BoardWindowDeps): { refresh(): void; open(): boolean } {
  const body = h('div.body.hoop-board');
  const el = h(
    'div.modal.hoop-window',
    { role: 'dialog', 'aria-label': 'Longest shots' },
    h('header', {}, h('h2', {}, '🏀 Longest shots')),
    body,
    h('footer', {}, h('span.grow', {}, 'The office measures every make itself, from where you stood when it left your hands. One row a person: their longest.')),
  );
  let modal: Modal | null = openModal(el, { doing: '🏀 reading the scoreboard', onClose: () => (modal = null) });

  function refresh() {
    if (!modal) return;
    const { shots, wins } = store.hoopBoard;
    const latest = store.hoopLatest && performance.now() - store.hoopLatest.at < NEWEST_FOR ? store.hoopLatest : null;
    const parts: (HTMLElement | null)[] = [];

    const pig = store.pig;
    if (pig) {
      const mine = pig.players.some((p) => p.id === store.you) && pig.winner === null;
      parts.push(
        h(
          'section.hoop-pig',
          {},
          h('h3', {}, pig.winner === null ? '🐷 PIG, on now' : '🐷 PIG, just now'),
          h('p.hoop-line', {}, scoreLine(pig)),
          h('p.hoop-news', {}, pig.news),
          mine ? h('button.btn', { type: 'button', onclick: () => deps.quit() }, 'Give up') : null,
        ),
      );
    }

    parts.push(
      shots.length
        ? h(
            'ol.hoop-shots',
            {},
            ...shots.map((s, i) =>
              h(
                'li',
                { class: latest && latest.rank === i + 1 && latest.name === s.name ? 'new' : '' },
                h('span.rank', {}, ordinal(i + 1)),
                h('span.dot', { style: `background:${s.color}` }),
                h('span.name', {}, clip(s.name, 24)),
                h('span.dist', {}, metres(s.dist), h('small', {}, ` ${inFeet(s.dist)} ft`)),
                h('span.when', { title: new Date(s.at).toLocaleString() }, timeAgo(s.at)),
              ),
            ),
          )
        : h('p.hoop-empty', {}, 'No makes yet. Sink one from anywhere on the floor and you’re on the board.'),
    );

    parts.push(h('h3', {}, '🐷 PIG wins'));
    parts.push(
      wins.length
        ? h('ol.hoop-wins', {}, ...wins.map((w) => h('li', {}, h('span.dot', { style: `background:${w.color}` }), h('span.name', {}, clip(w.name, 24)), h('span.wins', {}, `${w.wins} ${w.wins === 1 ? 'win' : 'wins'}`))))
        : h('p.hoop-empty', {}, 'No games won yet.'),
    );

    if (!pig || pig.winner !== null) {
      const partners = deps.partners();
      parts.push(
        h(
          'section.hoop-play',
          {},
          h('h3', {}, 'Play PIG'),
          h('p.hoop-rules', {}, 'Take turns. Sink one from anywhere and the other has to sink it from the same spot, or take a letter: P, then I, then G. Miss your own and the lead goes over. Spell PIG and you lose.'),
          partners.length
            ? h(
                'div.hoop-partners',
                {},
                ...partners.map((p) => h('button.btn.primary', { type: 'button', onclick: () => deps.invite(p.id) }, p.asked ? `🐷 ${clip(p.name, 16)} asked you: play` : `🐷 Play PIG with ${clip(p.name, 16)}`)),
              )
            : h('p.hoop-empty', {}, 'It takes two: nobody else is at the court.'),
        ),
      );
    }
    body.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
  }
  refresh();
  return { refresh, open: () => !!modal };
}

/**
 * `name` asks you to play PIG: a toast that stays a while, with Play and No thanks (P plays, too).
 * Hands back a way to take it down.
 */
export function inviteToast(name: string, ms: number, answer: (yes: boolean) => void): () => void {
  const done = () => {
    clearTimeout(timer);
    el.remove();
  };
  const el = h(
    'div.toast.pig-invite',
    {},
    h('span', {}, `🐷 ${clip(name, 20)} wants to play PIG`),
    h('span.pig-keys', {}, h('span.key', {}, 'P'), ' at the hoop'),
    h(
      'button.btn.primary',
      {
        type: 'button',
        onclick: () => {
          done();
          answer(true);
        },
      },
      'Play',
    ),
    h(
      'button.btn',
      {
        type: 'button',
        onclick: () => {
          done();
          answer(false);
        },
      },
      'No thanks',
    ),
  );
  $('toasts').append(el);
  const timer = setTimeout(done, ms);
  return done;
}
