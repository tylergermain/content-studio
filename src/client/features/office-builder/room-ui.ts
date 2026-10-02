/**
 * The room's structure, in the builder's left panel under The room (see ui.ts): what the floor has for
 * an upstairs, whether the corner loft is the boss's office, whether there's a kitchen, which of its
 * outside walls are wood and in which wood, and how many tees are out on the balcony. Each choice is a
 * patch to the floor's RoomOptions (shared/floorplan.ts), part of the draft and saved with the layout.
 */
import { PANEL_SIDES, type FloorRoom, type RoomOptions } from '../../../shared/floorplan';
import type { Side } from '../../../shared/layout';
import type { MezzanineKind } from '../../../shared/mezzanine';
import { h } from '../../ui/dom';

/** One choice of a few: what it says, whether it's the one chosen, what choosing it does, and what hovering over it says. */
export type Choice = [label: string, on: boolean, run: () => void, title?: string];

/** A row of choices of which one is on (a segmented control), or with `many`, of which any are; `tall` stacks them, where their names are long. */
export function segments(choices: readonly Choice[], opts: { label: string; disabled?: boolean; many?: boolean; tall?: boolean }): HTMLElement {
  return h(
    'div.ob-seg',
    { class: opts.tall ? 'tall' : '', role: opts.many ? 'group' : 'radiogroup', 'aria-label': opts.label },
    ...choices.map(([label, on, run, title]) =>
      h('button', { type: 'button', class: on ? 'on' : '', role: opts.many ? undefined : 'radio', [opts.many ? 'aria-pressed' : 'aria-checked']: String(on), title, disabled: opts.disabled, onclick: () => (opts.many || !on) && run() }, label),
    ),
  );
}

const LAYOUTS: readonly [kind: MezzanineKind, label: string, title: string][] = [
  ['none', 'One level', 'No upstairs: the whole floor is one level'],
  ['corner', 'Corner loft', 'The glass loft in the south-east corner, with stairs along the south wall'],
  ['big', 'Big mezzanine', 'A deck along the whole south side, with stairs up from the middle of the floor'],
];

const LAYOUT_NOTES: Record<MezzanineKind, string> = {
  none: 'No stairs and nothing overhead. The meeting room stands open to the ceiling.',
  corner: 'A glass room on posts over the meeting room, with stairs along the south wall.',
  big: 'A deck wall to wall along the south side, a third of the floor, with stairs up beside the fire pole. It comes empty: furnish it on the Upstairs level.',
};

const SIDE_NAMES: Record<Side, [letter: string, name: string]> = { north: ['N', 'North'], east: ['E', 'East'], south: ['S', 'South'], west: ['W', 'West'] };

export function createRoomUi(set: (patch: RoomOptions) => void) {
  const el = h('div.ob-back');
  const part = (title: string, ...children: (HTMLElement | false)[]) => h('div.ob-part', {}, h('span.ob-part-name', {}, title), ...children);
  const note = (text: string) => h('p.ob-note', {}, text);

  /** What's drawn, so it's only drawn again when the room or `busy` changes. */
  let drawn = '';

  /** Draws the choices for the room as the draft has it; nothing can be chosen while a save's on its way (`busy`). */
  function render(room: FloorRoom, busy: boolean) {
    const key = JSON.stringify([room, busy]);
    if (key === drawn) return;
    drawn = key;
    const seg = (label: string, choices: readonly Choice[], opts: { many?: boolean; tall?: boolean } = {}) => segments(choices, { label, disabled: busy, ...opts });
    const panels = (side: Side) => (room.panels.includes(side) ? room.panels.filter((s) => s !== side) : [...room.panels, side]);
    const parts: (HTMLElement | false)[] = [
      part(
        'Layout',
        seg(
          'Layout',
          LAYOUTS.map(([kind, label, title]): Choice => [label, room.mezzanine === kind, () => set({ mezzanine: kind }), title]),
          { tall: true },
        ),
        note(LAYOUT_NOTES[room.mezzanine]),
      ),
      room.mezzanine === 'corner' &&
        part(
          'The loft is',
          seg('The loft is', [
            ['Boss’s office', room.boss, () => set({ boss: true }), 'The boss’s desk, its chairs and monitors, the couch and the telescope'],
            ['Empty room', !room.boss, () => set({ boss: false }), 'An empty glass room, to furnish yourself'],
          ]),
          !room.boss && note('An empty glass room: furnish it on the Upstairs level.'),
        ),
      part(
        'Kitchen',
        seg('Kitchen', [
          ['Kitchen', room.kitchen, () => set({ kitchen: true }), 'The counter, the fridge and the coffee machine in the south-west corner'],
          ['No kitchen', !room.kitchen, () => set({ kitchen: false }), 'That corner is floor like any other'],
        ]),
      ),
      part(
        'Wood walls',
        seg(
          'Wood walls',
          PANEL_SIDES.map((side): Choice => [SIDE_NAMES[side][0], room.panels.includes(side), () => set({ panels: panels(side) }), `${SIDE_NAMES[side][1]} wall`]),
          { many: true },
        ),
        room.panels.length > 0 &&
          seg('Wood', [
            ['Oak', room.wood === 'oak', () => set({ wood: 'oak' })],
            ['Walnut', room.wood === 'walnut', () => set({ wood: 'walnut' })],
          ]),
        note(room.panels.length ? 'Slats floor to ceiling on those walls, round the windows and doors.' : 'Any of the room’s four outside walls in wood slats, floor to ceiling. North is the wall with the boards.'),
      ),
      part(
        'Driving tees',
        seg('Driving tees', [
          ['1 tee', room.tees === 1, () => set({ tees: 1 })],
          ['2 tees', room.tees === 2, () => set({ tees: 2 }), 'A second bay on the balcony, to tee off side by side'],
        ]),
      ),
    ];
    el.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
  }

  return { el, render };
}
