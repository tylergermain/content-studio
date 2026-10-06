/**
 * Which floors you may work on (shared/floor-access.ts), in the 3D office: on a floor you're read-only on, the top
 * bar says so, and a click says what that means. The office refuses what you can't do there whatever the page shows.
 */
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { addHudAction } from '../../ui/menu';
import { mayWork, readOnlyText } from '../../../shared/floor-access';

export function installFloorAccess(ctx: Ctx) {
  const readOnly = () => !!store.floor && !mayWork(store.me, store.floor);
  addHudAction({
    id: 'read-only',
    icon: '\u{1f440}',
    label: 'Read-only here',
    section: 'Office',
    shown: readOnly,
    status: readOnly,
    chip: () => 'Read-only here',
    title: () => readOnlyText(store.currentFloor()?.name ?? 'this floor'),
    run: () => toast(`\u{1f440} ${readOnlyText(store.currentFloor()?.name ?? 'this floor')}. You can still ride here, look round, and read its workers\u2019 chats, files and reviews.`),
  });
  store.on('me', () => ctx.hud.refresh());
  store.on('floors', () => ctx.hud.refresh());
}
