/**
 * The builder's panels, over the room: the bar along the top (undo, the walls, saving), the catalog of
 * furniture down the left, what's picked on the right, and what the builder has to say at the bottom.
 * Between them the room shows through, and that's where you drag things (see mode.ts).
 */
import './ui.css';
import { FLOOR_PALETTES } from '../../../shared/floors';
import { FURNITURE, FURNITURE_GROUPS, FURNITURE_KINDS, MAX_PIECE_TEXT, PIECE_SCALE, kindDef, type FurnitureKind, type Piece } from '../../../shared/furniture';
import { WING } from '../../../shared/layout';
import { SNAP, type DeskPose } from '../../../shared/office-builder';
import { store } from '../../state';
import { h } from '../../ui/dom';

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
  online(): boolean;
}

/** What the panels do. */
export interface BuilderActions {
  add(kind: FurnitureKind): void;
  /** A press on a catalog card: a click adds the piece, a drag carries it out onto the floor. */
  place(kind: FurnitureKind, e: PointerEvent): void;
  moveTo(x: number, z: number): void;
  turn(way: 1 | -1): void;
  recolor(color: string): void;
  resize(scale: number): void;
  retext(text: string): void;
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
  expand(): void;
  shrink(): void;
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
  ['R', 'Turn what’s picked'],
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

  // ---- The catalog ------------------------------------------------------------------------------
  const paints = h('div.ob-paints');
  const backOffice = h('div.ob-back');
  const catalog = h(
    'aside.ob-panel.ob-catalog',
    { 'aria-label': 'Furniture' },
    h('h3', {}, 'Add furniture'),
    h('p.ob-note', {}, 'Click one to add it, or drag it out onto the floor.'),
    ...FURNITURE_GROUPS.flatMap((group) => [
      h('h4', {}, group),
      h(
        'div.ob-cards',
        {},
        ...FURNITURE_KINDS.filter((kind) => FURNITURE[kind].group === group && !kindDef(kind).fixed).map((kind) => {
          const k = kindDef(kind);
          return h('button.ob-card', { type: 'button', title: `${k.label}: click to add, or drag onto the floor`, onpointerdown: ((e: PointerEvent) => act.place(kind, e)) as EventListener }, h('span.ob-icon', {}, k.icon), h('span', {}, k.label));
        }),
      ),
    ]),
    h('h3', {}, 'The room'),
    h('h4', {}, 'Paint'),
    paints,
    h('h4', {}, 'Back office'),
    backOffice,
  );

  // ---- What's picked ----------------------------------------------------------------------------
  const inspector = h('aside.ob-panel.ob-inspector', { 'aria-label': 'Selection' });
  const status = h('p.ob-says', { role: 'status' });
  const ask = h('div.ob-ask');
  const foot = h('footer.ob-panel.ob-status', {}, status, ask);
  const root = h('section.office-builder', { role: 'dialog', 'aria-label': 'Office builder' }, view, bar, catalog, inspector, foot);

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
    out.push(h('div.ob-row', {}, h('button.btn', { type: 'button', disabled: fixed, title: 'Turn it left (Shift R)', onclick: () => act.turn(-1) }, '⟲ Turn'), h('button.btn', { type: 'button', disabled: fixed, title: 'Turn it right (R)', onclick: () => act.turn(1) }, '⟳ Turn')));
    if (p.piece && k?.text !== undefined) {
      const input = h('input', { type: 'text', maxlength: MAX_PIECE_TEXT, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
      input.value = p.piece.text ?? '';
      input.addEventListener('change', () => act.retext(input.value));
      out.push(field('It says', input));
    }
    if (p.piece && k?.sizes) {
      const input = h('input', { type: 'range', min: PIECE_SCALE.min, max: PIECE_SCALE.max, step: 0.1 }) as HTMLInputElement;
      input.value = String(p.piece.scale ?? 1);
      input.addEventListener('change', () => act.resize(input.valueAsNumber));
      out.push(field('Size', input));
    }
    if (p.piece && k?.color) {
      const now = p.piece.color ?? k.color;
      const custom = h('input.ob-custom', { type: 'color', title: 'Any color', 'aria-label': 'Any color' }) as HTMLInputElement;
      custom.value = now;
      custom.addEventListener('change', () => act.recolor(custom.value));
      out.push(
        h(
          'div.ob-field',
          {},
          h('span', {}, 'Color'),
          h('div.ob-swatches', {}, ...SWATCHES.map((c) => h('button.ob-swatch', { type: 'button', class: c === now ? 'on' : '', style: `background:${c}`, title: c, 'aria-label': c, onclick: () => act.recolor(c) })), custom),
        ),
      );
    }
    if (k?.fixed) out.push(h('p.ob-note', {}, 'It comes with the office: put it anywhere on the floor.'));
    else if (p.piece) out.push(h('div.ob-row', {}, button('Duplicate', 'Another one like it (Ctrl/⌘ D)', act.duplicate), button('Remove', 'Take it off the floor (Delete)', act.remove, '.danger')));
    else out.push(button('Change desk sign', 'The sign hanging over this desk', act.sign));
    return out;
  }

  /** What the inspector last drew, so it's only drawn again when that changes (and never mid-way through typing in it). */
  let drawn = '';

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

    const p = state.picked();
    const key = JSON.stringify([p, pending]);
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
    const wing = store.floorPlan.wing;
    backOffice.replaceChildren(
      h('p.ob-note', {}, `${16 + wing * 2} desks, with room for ${(WING.rows - wing) * 2} more through the north wall. This applies straight away.`),
      h('div.ob-row', {}, h('button.btn', { type: 'button', disabled: wing >= WING.rows, onclick: act.expand }, 'Add 2 desks'), h('button.btn', { type: 'button', disabled: wing === 0, onclick: act.shrink }, 'Wall it up')),
    );
  }

  return { root, view, render };
}
