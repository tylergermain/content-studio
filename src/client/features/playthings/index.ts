/**
 * Things on the floor to play with (see KindDef.play and KindDef.bounce in shared/furniture.ts): the
 * punching bag, the vending machine, the trampoline.
 */
import type { Ctx } from '../../core/context';
import { hintTitle, key, onE } from '../../core/hint';
import { kindDef } from '../../../shared/furniture';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    plaything: true;
  }
}

export interface PlaythingsDeps {
  /** A can from the vending machine: the coffee's buzz (see features/coffee). */
  snack(): void;
}

export function installPlaythings(ctx: Ctx, _deps: PlaythingsDeps) {
  ctx.interactions.define('plaything', {
    reach: 3,
    hint: (it) => {
      const v = it.pieceId ? ctx.office.furniture.get(it.pieceId) : undefined;
      const k = v ? kindDef(v.piece.kind) : undefined;
      return { k: v?.piece.id ?? '', parts: [hintTitle(`${k?.icon ?? ''} ${k?.label ?? ''}`), key('E', 'Use')] };
    },
    use: onE(() => {}),
  });
}
