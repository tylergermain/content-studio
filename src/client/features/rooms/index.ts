/**
 * The Rooms panel (ui/rooms/panel.ts) in the 3D office: ☰ › Rooms, on a floor with project rooms. A new task in a room
 * is the hire dialog at the first free chair of its table.
 */
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { layoutFurniture } from '../../../shared/office-builder';
import { openRoomsPanel } from '../../ui/rooms/panel';
import { addHudAction } from '../../ui/menu';

export function installRooms(_ctx: Ctx, deps: { hireAtDesk(deskId: string): void; openWorker(id: string): void }) {
  addHudAction({
    id: 'rooms',
    icon: '\u{1f3ed}',
    label: 'Rooms',
    section: 'Open',
    shown: () => !!store.floor && layoutFurniture(store.floorPlan).some((p) => p.kind === 'project-room'),
    title: () => 'This floor’s project rooms: set one up for a GitHub repository, see who’s at its table, start a task there',
    run: () => openRoomsPanel({ hireAt: deps.hireAtDesk, openWorker: deps.openWorker }),
  });
}
