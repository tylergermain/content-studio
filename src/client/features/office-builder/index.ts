/**
 * The office builder: the floor's desks and furniture stand wherever its layout has them, and an admin
 * rearranges them in build mode (U, or the menu), dragging them about the room itself (see mode.ts).
 */
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { createBuildMode, type BuildDeps } from './mode';
import { createLayoutSync } from './sync';

/** Opens the builder, once it's installed (the menu's way in). */
let opener: (() => void) | null = null;
export function openOfficeBuilder() {
  opener?.();
}

/** Registers the floor's layout (store 'floorPlan') and U. */
export function installOfficeBuilder(ctx: Ctx, deps: BuildDeps) {
  const sync = createLayoutSync(ctx);
  const mode = createBuildMode(ctx, sync, deps);
  store.on('floorPlan', () => {
    // While you build, the room shows your draft: the builder hears the plan changed instead.
    if (mode.active()) return mode.planChanged();
    sync.arrange(sync.saved(), store.floorPlan.wing);
    sync.settle();
  });
  // Not B: that's a desk's key (a shared shell at an empty one), and a key belongs to the first binding that has it.
  ctx.keys.bind({ code: 'KeyU', when: mode.canBuild, run: () => mode.open() });
  opener = mode.open;
  return { sync, open: mode.open, building: mode.active };
}
