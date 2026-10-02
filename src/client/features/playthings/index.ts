/**
 * Things on the floor to play with (see KindDef.play and KindDef.bounce in shared/furniture.ts): the
 * punching bag, the vending machine, the trampoline, the dance mat, the prize wheel, the high striker,
 * and the foosball and ping-pong tables. Each is furniture the office builder stands wherever a floor
 * wants it, modelled in play.glb (world/office/furniture-play.ts); what each does is a Toy (kit.ts) in
 * toys.ts or games.ts, and only you see and hear it: nothing of it goes to the office.
 */
import type { FurnitureKind } from '../../../shared/furniture';
import { kindDef } from '../../../shared/furniture';
import type { Ctx } from '../../core/context';
import { hintTitle, onE } from '../../core/hint';
import type { PieceView } from '../../world/office/furnish';
import { foosball, pingPong } from './games';
import type { Toy } from './kit';
import { danceMat, highStriker, prizeWheel, punchingBag, trampoline, vendingMachine } from './toys';

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

export function installPlaythings(ctx: Ctx, deps: PlaythingsDeps) {
  /** What each kind of furniture that's for playing with does. */
  const toys: Partial<Record<FurnitureKind, Toy>> = {
    'punching-bag': punchingBag(ctx),
    'vending-machine': vendingMachine(ctx, deps.snack),
    trampoline: trampoline(ctx),
    'dance-mat': danceMat(ctx),
    'prize-wheel': prizeWheel(ctx),
    'high-striker': highStriker(ctx),
    foosball: foosball(ctx),
    'ping-pong': pingPong(ctx),
  };

  /** The piece an interactable is the front of, with what it does. */
  function at(pieceId: string | undefined): { view: PieceView; toy: Toy | undefined } | undefined {
    const view = pieceId ? ctx.office.furniture.get(pieceId) : undefined;
    return view && { view, toy: toys[view.piece.kind] };
  }

  ctx.interactions.define('plaything', {
    reach: 3,
    hint: (it) => {
      const found = at(it.pieceId);
      const k = found ? kindDef(found.view.piece.kind) : undefined;
      const more = found?.toy?.hint?.(found.view);
      return { k: `${found?.view.piece.id ?? ''}|${more?.k ?? ''}`, parts: [hintTitle(`${k?.icon ?? ''} ${k?.label ?? ''}`), ...(more?.parts ?? [])] };
    },
    use: onE((it) => {
      const found = at(it.pieceId);
      if (found) found.toy?.use?.(found.view);
    }),
  });

  // Once you've moved: what standing on one does to you (the trampoline, the dance mat), and each one's own moving parts.
  const byKind = new Map<FurnitureKind, PieceView[]>();
  ctx.ticks.add('moved', (f) => {
    for (const list of byKind.values()) list.length = 0;
    // The furniture is the office floor's: none of it up on the roof, or on a map of its own.
    if (ctx.inOffice() && !ctx.upTop()) {
      for (const v of ctx.office.furniture.all()) {
        if (v.away || !toys[v.piece.kind]?.tick) continue;
        let list = byKind.get(v.piece.kind);
        if (!list) byKind.set(v.piece.kind, (list = []));
        list.push(v);
      }
    }
    for (const [kind, toy] of Object.entries(toys) as [FurnitureKind, Toy][]) toy.tick?.(byKind.get(kind) ?? [], f);
  });
}
