/**
 * The room's structure, in the builder's left panel under The room (see ui.ts): what the floor has for
 * an upstairs and how many flights go up to it, whether the corner loft is the boss's office, where
 * its workers meet, whether it has the Steps and a kitchen, what hangs under its ceiling, which of its
 * outside walls are wood and in which wood, and how many tees are out on the balcony. Each choice is a
 * patch to the floor's RoomOptions (shared/floorplan.ts), part of the draft and saved with the layout.
 * One the floor has no room for yet is refused, and the reason is said under the choice it was.
 */
import { PANEL_SIDES, roomOf, type CeilingKind, type FloorRoom, type RoomOptions } from '../../../shared/floorplan';
import { MEETING_SEATS, type Side } from '../../../shared/layout';
import type { MeetingKind } from '../../../shared/meeting-place';
import type { MezzanineKind } from '../../../shared/mezzanine';
import { store } from '../../state';
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

/** What's under the loft, or stands in that corner without it: the meeting room, on a floor whose workers meet there. */
const LAYOUT_NOTES: Record<MezzanineKind, (glassRoom: boolean) => string> = {
  none: (glassRoom) => (glassRoom ? 'No stairs and nothing overhead. The meeting room stands open to the ceiling.' : 'No stairs and nothing overhead.'),
  corner: (glassRoom) => `A glass room on posts ${glassRoom ? 'over the meeting room' : 'in the south-east corner'}, with stairs along the south wall.`,
  big: () => 'A deck wall to wall along the south side, a third of the floor, with stairs up beside the fire pole. It comes empty: furnish it on the Upstairs level.',
};

/** Where the floor's workers meet (see shared/meeting-place.ts): what the builder calls each, what's in its way as the office comes, and what it is. */
const MEETINGS: readonly [kind: MeetingKind, label: string, title: string, note: string][] = [
  ['room', 'Glass room', 'The glass meeting room in the south-east corner', 'A glass room in the south-east corner: a long table, and the meeting’s board on its back wall.'],
  [
    'forum',
    'Stage',
    'A panel table across the front of the lounge, in front of the TV. The jukebox and the arcade stand in front of its board, as the office comes: move them first',
    'A panel of five at a long table in front of the TV, facing the room. The meeting’s board hangs on the east wall beside it, and the floor in front of that is kept clear.',
  ],
  [
    'desk',
    'Anchor desk',
    'A long desk out on the office floor, with a prompter in front of it. Desks 5, 6 and 7 stand where it goes, as the office comes: move them first',
    'Five in a row behind a long desk out on the office floor, facing a prompter that shows the meeting’s board from both sides.',
  ],
];

/** What hangs under the ceiling, and the shade its pendants wear with it (see world/office/ceiling.ts). */
const CEILINGS: readonly [kind: CeilingKind, label: string, title: string, note: string][] = [
  ['tiles', 'Tiles', 'The ceiling the office comes with', 'The ceiling the office comes with, and its yellow cone pendants.'],
  ['beams', 'Beams', 'Timber beams across the room', 'Timber beams from the north wall to the south, and green pendants.'],
  ['banners', 'Banners', 'A row of banners overhead, and a ring of lights', 'A row of banners in the floor’s trim down the middle of the room, a ring of spotlights over where the stage goes, and globe pendants.'],
  ['grid', 'Lighting grid', 'A studio’s grid of pipes and spotlights', 'A studio’s grid of black pipes over the desks, a bar of spotlights over where the anchor desk goes, and black dome pendants.'],
];

const SIDE_NAMES: Record<Side, [letter: string, name: string]> = { north: ['N', 'North'], east: ['E', 'East'], south: ['S', 'South'], west: ['W', 'West'] };

/** The choices under Structure, by name: which one a refusal is said under. */
type PartName = 'Layout' | 'The loft is' | 'Stairs' | 'Meeting place' | 'The Steps' | 'Kitchen' | 'Ceiling' | 'Wood walls' | 'Driving tees';

/** `set` changes some of the room's fittings in the draft, and says why when it couldn't. */
export function createRoomUi(set: (patch: RoomOptions) => string | undefined) {
  const el = h('div.ob-back');
  const note = (text: string) => h('p.ob-note', {}, text);
  const warn = (text: string) => h('p.ob-note.warn', { role: 'alert' }, text);

  /** What's drawn, so it's only drawn again when the room, `busy` or what there is to say changes. */
  let drawn = '';
  /** What render was last given, to draw again from. */
  let last: [room: FloorRoom, busy: boolean, said: string] | undefined;
  /** The choice the builder last refused, and why: said under it for as long as the builder's still saying so. */
  let refused: { part: PartName; why: string } | undefined;

  /** Makes a choice under `part`. One the floor has no room for stays as it was, with why under it. */
  function choose(part: PartName, patch: RoomOptions) {
    refused = undefined;
    const why = set(patch);
    if (!why || !last) return;
    refused = { part, why };
    render(last[0], last[1], why);
  }

  /**
   * Draws the choices for the room as the draft has it; nothing can be chosen while a save's on its way
   * (`busy`). `said` is what the builder is saying just now (see the status line in ui.ts).
   */
  function render(room: FloorRoom, busy: boolean, said: string) {
    last = [room, busy, said];
    const why = refused?.why === said ? refused : undefined;
    // Where the floor's workers meet stays where it is while any of them is sat there (the office refuses the save).
    const meets = roomOf(store.floorPlan).meeting;
    const sitting = MEETING_SEATS.some((d) => store.workerAtDesk(d.id));
    const key = JSON.stringify([room, busy, why, sitting && meets]);
    if (key === drawn) return;
    drawn = key;

    const part = (name: PartName, ...children: (HTMLElement | false)[]) => h('div.ob-part', {}, h('span.ob-part-name', {}, name), ...children, why?.part === name && warn(why.why));
    const seg = (label: PartName | 'Wood', choices: readonly Choice[], opts: { many?: boolean; tall?: boolean; disabled?: boolean } = {}) => segments(choices, { label, ...opts, disabled: busy || opts.disabled });
    const pick = (name: PartName, patch: RoomOptions) => () => choose(name, patch);
    const panels = (side: Side) => (room.panels.includes(side) ? room.panels.filter((s) => s !== side) : [...room.panels, side]);
    const meeting = MEETINGS.find(([kind]) => kind === room.meeting)!;
    const savedMeeting = MEETINGS.find(([kind]) => kind === meets)![1].toLowerCase();

    const parts: (HTMLElement | false)[] = [
      part(
        'Layout',
        seg(
          'Layout',
          LAYOUTS.map(([kind, label, title]): Choice => [label, room.mezzanine === kind, pick('Layout', { mezzanine: kind }), title]),
          { tall: true },
        ),
        note(LAYOUT_NOTES[room.mezzanine](room.meeting === 'room')),
      ),
      room.mezzanine === 'corner' &&
        part(
          'The loft is',
          seg('The loft is', [
            ['Boss’s office', room.boss, pick('The loft is', { boss: true }), 'The boss’s desk, its chairs and monitors, the couch and the telescope'],
            ['Empty room', !room.boss, pick('The loft is', { boss: false }), 'An empty glass room, to furnish yourself'],
          ]),
          !room.boss && note('An empty glass room: furnish it on the Upstairs level.'),
        ),
      room.mezzanine === 'big' &&
        part(
          'Stairs',
          seg('Stairs', [
            ['One flight', room.flights === 1, pick('Stairs', { flights: 1 }), 'Stairs up from the middle of the floor, beside the fire pole'],
            ['Two flights', room.flights === 2, pick('Stairs', { flights: 2 }), 'A second flight up to the deck’s west end'],
          ]),
          room.flights === 2 && note('A second flight climbs to the deck’s west end: up one and down the other.'),
        ),
      part(
        'Meeting place',
        seg(
          'Meeting place',
          MEETINGS.map(([kind, label, title]): Choice => [label, room.meeting === kind, pick('Meeting place', { meeting: kind }), title]),
          // With a meeting sat at it there's nothing to choose, unless the draft has it somewhere else already: then it can go back.
          { tall: true, disabled: sitting && room.meeting === meets },
        ),
        note(meeting[3]),
        sitting && warn(room.meeting === meets ? 'A meeting is sitting there now. The meeting place can move once it’s over.' : `A meeting is sitting at the ${savedMeeting} now. This can’t be saved until it’s over.`),
      ),
      part(
        'The Steps',
        seg('The Steps', [
          ['Steps', room.steps, pick('The Steps', { steps: true }), 'Six tiers across the lounge to sit on, facing the TV'],
          ['No Steps', !room.steps, pick('The Steps', { steps: false }), 'The lounge is floor like any other'],
        ]),
        note(room.steps ? 'Six tiers across the lounge, to walk up and sit on, facing the TV.' : 'An amphitheatre of six tiers across the lounge, facing the TV. The lounge’s furniture has to be out of its way first.'),
      ),
      part(
        'Kitchen',
        seg('Kitchen', [
          ['Kitchen', room.kitchen, pick('Kitchen', { kitchen: true }), 'The counter, the fridge and the coffee machine in the south-west corner'],
          ['No kitchen', !room.kitchen, pick('Kitchen', { kitchen: false }), 'That corner is floor like any other'],
        ]),
      ),
      part(
        'Ceiling',
        seg(
          'Ceiling',
          CEILINGS.map(([kind, label, title]): Choice => [label, room.ceiling === kind, pick('Ceiling', { ceiling: kind }), title]),
          { tall: true },
        ),
        note(CEILINGS.find(([kind]) => kind === room.ceiling)![3]),
      ),
      part(
        'Wood walls',
        seg(
          'Wood walls',
          PANEL_SIDES.map((side): Choice => [SIDE_NAMES[side][0], room.panels.includes(side), pick('Wood walls', { panels: panels(side) }), `${SIDE_NAMES[side][1]} wall`]),
          { many: true },
        ),
        room.panels.length > 0 &&
          seg('Wood', [
            ['Oak', room.wood === 'oak', pick('Wood walls', { wood: 'oak' })],
            ['Walnut', room.wood === 'walnut', pick('Wood walls', { wood: 'walnut' })],
          ]),
        note(room.panels.length ? 'Slats floor to ceiling on those walls, round the windows and doors.' : 'Any of the room’s four outside walls in wood slats, floor to ceiling. North is the wall with the boards.'),
      ),
      part(
        'Driving tees',
        seg('Driving tees', [
          ['1 tee', room.tees === 1, pick('Driving tees', { tees: 1 })],
          ['2 tees', room.tees === 2, pick('Driving tees', { tees: 2 }), 'A second bay on the balcony, to tee off side by side'],
        ]),
      ),
    ];
    el.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
  }

  return { el, render };
}
