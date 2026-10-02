# Office builder

Back to the [README](../README.md).

Open **Menu → Office builder**, or press **U**, on an office floor. Building is for admins. The castle and other custom maps keep their own layouts.

The camera goes up over the room with the ceiling off and the walls cut away, and you arrange the floor itself: pick something up, drag it across the floor, and let go. What you do is a draft that only you see until you **Save layout**; closing the builder (✕ or Esc) puts the room back as it's saved, after asking if there are changes to lose.

## What you can arrange

- **The workers' desks.** The room's 16 desks go anywhere there's floor for the desk and its chair. Each one stays on the floor (workers keep their desk ids), and a desk with a worker at it stays put until that worker is sent home.
- **Furniture.** Everything else that stands on the floor: the lounge's couch, table and poufs, the rugs, the plants, and whatever you add from the catalog on the left. Click a card to drop one in the middle of the view, or drag it out onto the floor.
- **What the office comes with.** The whiteboard, the jukebox, the arcade cabinet, the docs bookshelf and the gong move and turn like furniture. There's one of each, so they can't be duplicated or removed.
- **The room's paint.** Pick one of the floor palettes under *The room*, or *Own* for the floor's own color.
- **The back office.** *Add 2 desks* and *Wall it up* knock the back office out or close it again. Unlike everything else these apply straight away.

The catalog has team desks, tables, sofas, armchairs, poufs, plants in three species, rugs in four shapes, dividers, bookcases, floor lamps and signs. With a piece picked, the panel on the right sets its position, turns it, paints it (a swatch, or any color), sizes a plant, or changes what a sign says.

Walls, the meeting room, the loft, the kitchen, the wall boards, the TV, the board agents' kiosks, the elevator, the stairs, the ladder and the fire pole stay where they are. The builder keeps furniture off them and out of the doorways, and says why when something can't stand where you dropped it: it goes back where it was. Rugs lie under anything.

## Team desks

A **team desk** is a desk for a person rather than a worker: a desk with a monitor and a chair. Walk up and press **E** to sit down. Sitting down shares your screen (the browser asks which window or screen, as it always does), and it goes up on the desk's monitor for everyone on the floor, as well as on the lounge TV and the shares strip. Getting up stops sharing. If you were already sharing when you sat down, that share carries on and is yours to stop.

Sofas, armchairs and poufs you add are seats too.

## Controls

| | |
| --- | --- |
| Drag a desk or a piece | Move it, a quarter meter at a time (hold **Alt** for 5 cm) |
| Drag the floor | Slide the view |
| Right-drag, or **Shift** + drag | Turn and tilt the view |
| Scroll | Zoom |
| **W A S D**, **Q E**, **+ −** | Slide, turn and zoom the view from the keyboard |
| **R** / **Shift R** | Turn what's picked a quarter turn (round things an eighth) |
| Arrow keys | Nudge what's picked a step |
| **Delete** | Remove the picked piece |
| **Ctrl/⌘ D** | Another one like it |
| **Ctrl/⌘ Z**, **Ctrl/⌘ Shift Z** | Undo, redo |
| **Ctrl/⌘ S** | Save |
| **Esc** | Let go of what's picked, then close |

*Walls* in the top bar stands the walls back up to see the room whole. A rug takes two presses: the first picks it (so dragging across one still slides the view), the next drags it.

## Saving

**Save layout** applies the draft to everyone on the floor: what's in the way, where there is to sit, and how the dog and the workers get round the room all follow. Layouts are kept per floor in that floor's `.agent-office/floorplan.json`, with its desk signs and its back office, across restarts. **Reload saved** throws the draft away. **Original office** puts the office back as it comes (as a draft, to save). If another admin saves while you're building, your draft is kept and you're asked to reload before saving over theirs.

Anyone sitting on something that was moved moves with it; on something that was removed, they're stood up. Anyone standing where something now stands steps out of it.

A layout saved by an older version that no longer fits (a piece where something built-in now is) is dropped when the floor loads: the office as it comes, with the floor's signs and back office kept.

## Where it lives

The catalog and each kind's footprint are in [`src/shared/furniture.ts`](../src/shared/furniture.ts), the rules for where things may stand in [`src/shared/office-builder.ts`](../src/shared/office-builder.ts) and [`src/shared/office-fixed.ts`](../src/shared/office-fixed.ts), how each piece looks in [`src/client/world/office/furniture.ts`](../src/client/world/office/furniture.ts), and build mode in [`src/client/features/office-builder/`](../src/client/features/office-builder). Team desks' screen sharing is [`src/client/features/workstation/`](../src/client/features/workstation). A new kind of furniture is an entry in `FURNITURE` and a case in `buildPiece`.
