/**
 * The builder's panels, over the room: the bar along the top (undo, the walls, saving), the level
 * being worked on under it (on a floor with an upstairs to furnish), the catalog of furniture and the
 * room's own options down the left (room-ui.ts), what's picked on the right (a painting's side of it is
 * hang-ui.ts), and what the builder has to say at the bottom. Between them the room shows through, and
 * that's where you drag things (see mode.ts).
 */
import './ui.css';
import type { FloorRoom, RoomOptions } from '../../../shared/floorplan';
import { FLOOR_PALETTES } from '../../../shared/floors';
import { FURNITURE, FURNITURE_GROUPS, FURNITURE_KINDS, MAX_PIECE_TEXT, PIECE_SCALE, canGoUp, kindDef, type FurnitureKind, type Piece } from '../../../shared/furniture';
import { WING } from '../../../shared/layout';
import { SNAP, type DeskPose } from '../../../shared/office-builder';
import { store } from '../../state';
import { h } from '../../ui/dom';
import { hangUi } from './hang-ui';
import type { Level, Upstairs } from './levels';
import { mediaPicker } from './media-picker';
import { createRoomUi, segments } from './room-ui';

/** What's picked, as the inspector shows it: a piece of furniture, or (with no `piece`) one of the room's desks. */
export interface Picked {
  id: string;
  label: string;
  icon: string;
  pose: DeskPose;
  piece?: Piece;
  /** Why it can't be moved, when it can't. */
  locked?: string;
}

/** What the panels show of the builder. */
export interface BuilderState {
  picked(): Picked | null;
  status(): { text: string; tone: 'info' | 'warn' };
  dirty(): boolean;
  pending(): boolean;
  conflict(): boolean;
  /** Asking whether to throw the draft away, on the way out. */
  asking(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  wallsCut(): boolean;
  look(): number | undefined;
  /** The room's own fittings, as the draft has them. */
  room(): FloorRoom;
  online(): boolean;
  /** The level being worked on: the office floor, or (1) upstairs. */
  level(): Level;
  /** The floor's upstairs, as the draft has it: whether there's one to furnish, and what's up there. */
  upstairs(): Upstairs;
}

/** What the panels do. */
export interface BuilderActions {
  add(kind: FurnitureKind): void;
  /** A press on a catalog card: a click adds the piece, a drag carries it out onto the floor. */
  place(kind: FurnitureKind, e: PointerEvent): void;
  moveTo(x: number, z: number): void;
  turn(way: 1 | -1): void;
  /** Changes what the picked piece is like: its paint, its size, its words, a painting's picture and frame (a key with nothing takes that away). */
  edit(patch: Partial<Piece>): void;
  /** What a screen plays: one video, by its name in the floor's media folder; WATCH_MEDIA; or '' for every video there. */
  remedia(media: string): void;
  duplicate(): void;
  remove(): void;
  /** The sign over the picked desk. */
  sign(): void;
  undo(): void;
  redo(): void;
  save(): void;
  reload(): void;
  reset(): void;
  walls(): void;
  paint(look: number | undefined): void;
  /** Changes some of the room's own fittings (see RoomOptions). */
  room(patch: RoomOptions): void;
  /** Works on the office floor, or (1) upstairs. */
  level(to: Level): void;
  /** Moves the picked piece to the other level. */
  relevel(): void;
  /** Stands the starter rooms on the big mezzanine. */
  starter(): void;
  /** Takes everything upstairs away. */
  clearUp(): void;
  expand(): void;
  shrink(): void;
  /** The floor's boards, kiosk agents and ticker (see features/studio). */
  setup(): void;
  close(): void;
  discard(): void;
  keep(): void;
}

/** Paint to pick from, for anything that can be painted. */
const SWATCHES = ['#5b8def', '#5bc0eb', '#8ecae6', '#06d6a0', '#9bc53d', '#caffbf', '#ffd166', '#ffb400', '#ff8a5b', '#ef476f', '#f7aef8', '#b388eb', '#c98b5a', '#8a5a3b', '#f7f3ea', '#2b2d42'];

const CONTROLS: [string, string][] = [
  ['Drag', 'Move a desk or a piece'],
  ['Drag the floor', 'Slide the view'],
  ['Right-drag', 'Turn the view (or Shift + drag)'],
  ['Scroll', 'Zoom'],
  ['R', 'Turn what’s picked (a painting: to the wall’s other side)'],
  ['Arrows', 'Nudge it a step'],
  ['Alt + drag', 'Move it finely'],
  ['Delete', 'Take it away'],
  ['Ctrl/⌘ D', 'Another one like it'],
  ['Ctrl/⌘ Z', 'Undo'],
  ['W A S D', 'Slide the view'],
  ['Q E', 'Turn the view'],
];

export function createBuilderUi(state: BuilderState, act: BuilderActions) {
  const button = (label: string, title: string, run: () => void, cls = '') => h(`button.btn${cls}` as 'button', { type: 'button', title, onclick: run }, label);
  const view = h('div.ob-view');

  // ---- The bar ----------------------------------------------------------------------------------
  const undo = button('↶ Undo', 'Undo (Ctrl/⌘ Z)', act.undo);
  const redo = button('↷ Redo', 'Redo (Ctrl/⌘ Shift Z)', act.redo);
  const walls = button('', 'Cut the walls away to see in, or stand them back up', act.walls);
  const reload = button('Reload saved', 'Throw the draft away and load the layout as it’s saved', act.reload);
  const reset = button('Original office', 'Put everything back the way the office comes', act.reset);
  const save = button('Save layout', 'Save it for everyone on the floor (Ctrl/⌘ S)', act.save, '.primary');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onclick: act.close }, '✕');
  const bar = h('header.ob-panel.ob-bar', {}, h('div.ob-title', {}, h('span', {}, '📐'), h('h2', {}, 'Office builder')), h('div.ob-tools', {}, undo, redo, h('span.ob-gap'), walls, h('span.ob-gap'), reload, reset, save), close);
  /** Which level's being worked on, on a floor with an upstairs to furnish. */
  const levels = h('div.ob-panel.ob-levels', { 'aria-label': 'Level' });

  // ---- The catalog ------------------------------------------------------------------------------
  const paints = h('div.ob-paints');
  const backOffice = h('div.ob-back');
  const structure = createRoomUi(act.room);
  /** The catalog's cards, by kind: what only stands on the office floor can't be added upstairs. */
  const cards = new Map<FurnitureKind, HTMLButtonElement>();
  const card = (kind: FurnitureKind) => {
    const k = kindDef(kind);
    const el = h('button.ob-card', { type: 'button', onpointerdown: ((e: PointerEvent) => act.place(kind, e)) as EventListener }, h('span.ob-icon', {}, k.icon), h('span', {}, k.label));
    cards.set(kind, el);
    return el;
  };
  const catalog = h(
    'aside.ob-panel.ob-catalog',
    { 'aria-label': 'Furniture' },
    h('h3', {}, 'Add furniture'),
    h('p.ob-note', {}, 'Click one to add it, or drag it out onto the floor.'),
    ...FURNITURE_GROUPS.flatMap((group) => [h('h4', {}, group), h('div.ob-cards', {}, ...FURNITURE_KINDS.filter((kind) => FURNITURE[kind].group === group).map(card))]),
    h('h3', {}, 'The room'),
    h('h4', {}, 'Paint'),
    paints,
    h('h4', {}, 'Structure'),
    structure.el,
    h('h4', {}, 'Back office'),
    backOffice,
    h('h4', {}, 'Boards and agents'),
    h('p.ob-note', {}, 'What this floor’s wall boards are for, who stands at its kiosks, and the prices on its stock ticker (the bar is in the catalog, under Work).'),
    button('🪧 Set up the floor…', 'Boards, kiosk agents, the ticker, Slack and Metricool', act.setup),
  );

  // ---- What's picked ----------------------------------------------------------------------------
  const inspector = h('aside.ob-panel.ob-inspector', { 'aria-label': 'Selection' });
  const status = h('p.ob-says', { role: 'status' });
  const ask = h('div.ob-ask');
  const foot = h('footer.ob-panel.ob-status', {}, status, ask);
  const root = h('section.office-builder', { role: 'dialog', 'aria-label': 'Office builder' }, view, bar, levels, catalog, inspector, foot);

  const field = (label: string, input: HTMLElement) => h('label.ob-field', {}, h('span', {}, label), input);

  function number(value: number, set: (n: number) => void, disabled: boolean) {
    const input = h('input', { type: 'number', step: SNAP, disabled }) as HTMLInputElement;
    input.value = String(Math.round(value * 100) / 100);
    input.addEventListener('change', () => Number.isFinite(input.valueAsNumber) && set(input.valueAsNumber));
    return input;
  }

  function inspect(p: Picked): HTMLElement[] {
    const k = p.piece ? kindDef(p.piece.kind) : undefined;
    const fixed = !!p.locked || state.pending();
    const out: HTMLElement[] = [h('div.ob-picked', {}, h('span.ob-icon', {}, p.icon), h('div', {}, h('h3', {}, p.label || k?.label || ''), h('p.ob-note', {}, k?.fixed ? 'Part of the office' : k ? `${k.group} · ${k.label}` : 'A worker’s desk')))];
    if (p.locked) out.push(h('p.ob-note.warn', {}, p.locked));
    if (k?.seat?.share) out.push(h('p.ob-note', {}, 'A desk for one of you: sit down at it and your screen goes up on its monitor.'));
    else if (k?.seat) out.push(h('p.ob-note', {}, 'People can sit here.'));
    out.push(h('div.ob-row', {}, field('Across (m)', number(p.pose.x, (x) => act.moveTo(x, p.pose.z), fixed)), field('Along (m)', number(p.pose.z, (z) => act.moveTo(p.pose.x, z), fixed))));
    // What hangs has a wall behind it, and only the one other way to face: from the wall's other side.
    if (k?.hangs) out.push(h('button.btn', { type: 'button', disabled: fixed, title: 'Hang it on the other side of its wall (R)', onclick: () => act.turn(1) }, '⇄ Other side of the wall'));
    else out.push(h('div.ob-row', {}, h('button.btn', { type: 'button', disabled: fixed, title: 'Turn it left (Shift R)', onclick: () => act.turn(-1) }, '⟲ Turn'), h('button.btn', { type: 'button', disabled: fixed, title: 'Turn it right (R)', onclick: () => act.turn(1) }, '⟳ Turn')));
    if (p.piece && k?.text !== undefined) {
      const input = h('input', { type: 'text', maxlength: MAX_PIECE_TEXT, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
      input.value = p.piece.text ?? '';
      input.addEventListener('change', () => act.edit({ text: input.value }));
      out.push(field(p.piece.kind === 'doorway' ? 'The room’s name' : 'It says', input));
    }
    if (p.piece && k?.sizes) {
      const input = h('input', { type: 'range', min: PIECE_SCALE.min, max: PIECE_SCALE.max, step: 0.1 }) as HTMLInputElement;
      input.value = String(p.piece.scale ?? 1);
      input.addEventListener('change', () => act.edit({ scale: input.valueAsNumber }));
      out.push(field('Size', input));
    }
    if (p.piece && k?.color) {
      const now = p.piece.color ?? k.color;
      const custom = h('input.ob-custom', { type: 'color', title: 'Any color', 'aria-label': 'Any color' }) as HTMLInputElement;
      custom.value = now;
      custom.addEventListener('change', () => act.edit({ color: custom.value }));
      out.push(
        h(
          'div.ob-field',
          {},
          h('span', {}, 'Color'),
          h('div.ob-swatches', {}, ...SWATCHES.map((c) => h('button.ob-swatch', { type: 'button', class: c === now ? 'on' : '', style: `background:${c}`, title: c, 'aria-label': c, onclick: () => act.edit({ color: c }) })), custom),
        ),
      );
    }
    if (p.piece && k?.plays) out.push(...mediaPicker(p.piece.media, act.remedia));
    if (p.piece && k?.shows) out.push(...hangUi(p.piece, act.edit, fixed));
    // To the other level, on a floor with an upstairs to furnish: what's up there comes down, and what can go up goes.
    if (p.piece && (p.piece.level || (state.upstairs().there && canGoUp(p.piece.kind)))) out.push(button(p.piece.level ? '⬇ Move downstairs' : '⬆ Move upstairs', p.piece.level ? 'Stand it on the office floor' : 'Stand it up on the deck', act.relevel));
    if (k?.fixed) out.push(h('p.ob-note', {}, 'The office has one of these. Remove it and this floor goes without; the catalog puts it back.'), button('Remove from this floor', 'Take it off this floor (Delete)', act.remove, '.danger'));
    else if (p.piece) out.push(h('div.ob-row', {}, button('Duplicate', 'Another one like it (Ctrl/⌘ D)', act.duplicate), button('Remove', 'Take it off the floor (Delete)', act.remove, '.danger')));
    else out.push(button('Change desk sign', 'The sign hanging over this desk', act.sign));
    return out;
  }

  /** What the inspector last drew, so it's only drawn again when that changes (and never mid-way through typing in it). */
  let drawn = '';
  /** The same for the level bar: it's drawn again when the level, what's upstairs or a save changes it. */
  let levelled = '';

  function render() {
    const pending = state.pending();
    undo.disabled = !state.canUndo() || pending;
    redo.disabled = !state.canRedo() || pending;
    walls.textContent = state.wallsCut() ? '🧱 Walls: cut away' : '🧱 Walls: up';
    reload.disabled = pending || (!state.dirty() && !state.conflict());
    reset.disabled = pending;
    save.disabled = pending || state.conflict() || !state.dirty() || !state.online();
    save.textContent = pending ? 'Saving…' : 'Save layout';

    const s = state.status();
    status.textContent = s.text;
    status.classList.toggle('warn', s.tone === 'warn');
    const asking = state.asking();
    foot.classList.toggle('asking', asking);
    ask.replaceChildren(...(asking ? [h('span', {}, 'Leave without saving? Your changes will be lost.'), button('Keep building', '', act.keep), button('Discard changes', '', act.discard, '.danger')] : []));

    const up = state.upstairs();
    const level = state.level();
    const levelKey = JSON.stringify([level, up, pending]);
    if (levelKey !== levelled) {
      levelled = levelKey;
      levels.hidden = !up.there;
      const choose = segments(
        [
          ['Ground', level === 0, () => act.level(0), 'Arrange the office floor'],
          ['Upstairs', level === 1, () => act.level(1), 'Arrange what’s up on the deck'],
        ],
        { label: 'Level' },
      );
      const upHere = [
        h('span.ob-note', {}, up.pieces ? `${up.pieces} ${up.pieces === 1 ? 'piece' : 'pieces'} up here` : 'Nothing up here yet'),
        up.big && !up.pieces && h('button.btn', { type: 'button', disabled: pending, title: 'Four glass-fronted rooms along the deck, each with a doorway that names it', onclick: act.starter }, '＋ Add starter rooms'),
        up.pieces > 0 && h('button.btn', { type: 'button', disabled: pending, title: 'Take everything upstairs away (Undo brings it back)', onclick: act.clearUp }, 'Clear upstairs'),
      ].filter((el): el is HTMLElement => !!el);
      levels.replaceChildren(choose, ...(level === 1 ? upHere : []));
      // What only stands on the office floor can't be added upstairs.
      for (const [kind, el] of cards) {
        const k = kindDef(kind);
        const grounded = level === 1 && !canGoUp(kind);
        el.disabled = grounded;
        el.title = grounded ? `${k.label}: only stands on the office floor (switch to Ground to add one)` : `${k.label}: click to add, or drag onto the floor`;
      }
    }

    const p = state.picked();
    const key = JSON.stringify([p, pending, up.there]);
    if (key !== drawn) {
      drawn = key;
      inspector.replaceChildren(
        ...(p
          ? inspect(p)
          : [h('h3', {}, 'Nothing picked'), h('p.ob-note', {}, 'Click a desk or a piece of furniture to move it, turn it or paint it.'), h('dl.ob-keys', {}, ...CONTROLS.flatMap(([k, what]) => [h('dt', {}, k), h('dd', {}, what)]))]),
      );
    }

    const look = state.look();
    paints.replaceChildren(
      h('button.ob-paint', { type: 'button', class: look === undefined ? 'on' : '', title: 'The floor’s own paint', onclick: () => act.paint(undefined) }, 'Own'),
      ...FLOOR_PALETTES.map((f, i) => h('button.ob-paint', { type: 'button', class: look === i ? 'on' : '', title: f.name, 'aria-label': f.name, style: `background:linear-gradient(135deg, ${f.wall} 50%, ${f.floor} 50%);border-color:${f.trim}`, onclick: () => act.paint(i) })),
    );
    structure.render(state.room(), pending);
    const wing = store.floorPlan.wing;
    backOffice.replaceChildren(
      h('p.ob-note', {}, `${16 + wing * 2} desks, with room for ${(WING.rows - wing) * 2} more through the north wall. This applies straight away.`),
      h('div.ob-row', {}, h('button.btn', { type: 'button', disabled: wing >= WING.rows, onclick: act.expand }, 'Add 2 desks'), h('button.btn', { type: 'button', disabled: wing === 0, onclick: act.shrink }, 'Wall it up')),
    );
  }

  return { root, view, render };
}
