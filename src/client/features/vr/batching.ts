/**
 * The office's batcher (world/batch), for a headset's quality profile to turn on (see quality.ts): one
 * for the page, made the first time it's asked for. It batches the office floor's group, and the
 * roof's once there is one; it starts over whenever you're on another floor or up on the roof, or the
 * floor's furniture or its room change; and it holds off while the office builder is open, where
 * everything is dragged about. The batches' own shaders are compiled before they're first drawn.
 */
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { Batcher } from '../../world/batch/batcher';

const made = new WeakMap<Ctx, Batcher>();

export function officeBatcher(ctx: Ctx, parts: Pick<Parts, 'rooftop'>): Batcher {
  const had = made.get(ctx);
  if (had) return had;
  const { office } = ctx;
  /** Goes up whenever the room's own fittings change (see RoomView). */
  let rooms = 0;
  office.room.on(() => rooms++);
  const batcher = new Batcher({
    scene: ctx.scene,
    camera: ctx.camera,
    roots: () => {
      const roof = parts.rooftop.roof();
      return roof ? [office.group, roof.group] : [office.group];
    },
    version: () => `${store.floor}|${store.floors.length}|${ctx.upTop()}|${office.furniture.version}|${rooms}|${!!parts.rooftop.roof()}`,
    paused: () => ctx.activities.running('office-builder'),
    // The batches' own shaders, compiled side by side before they're built (see Batcher).
    warm: (probes) => ctx.renderer.compileAsync(probes, ctx.camera, ctx.scene),
  });
  ctx.ticks.add('pre', () => batcher.frame());
  made.set(ctx, batcher);
  // For the console and the headless checks.
  (window as unknown as { __batcher?: Batcher }).__batcher = batcher;
  return batcher;
}
