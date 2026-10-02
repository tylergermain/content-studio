import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { kindDef, pieceScale } from '../../../shared/furniture';
import { GOAT_NAME } from '../../../shared/protocol';
import { Goat } from './world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    goat: true;
  }
}

/**
 * Marc, the building's goat, on whichever floor he lives on: he ambles about, grazes on the plants and
 * gets up to a bit of mischief, and E pets him, which he answers with a bleat and by tagging along.
 */
export function installGoat(ctx: Ctx): Goat {
  const goat = new Goat({
    bleat: (x, z) => ctx.sound.bleat(x, z),
    // The same thump a punch gives the bag, a little softer.
    thud: (x, z) => ctx.sound.plaything('thud', { x, y: 1.1, z }, 0.7),
    bag: (id) => {
      const v = ctx.office.furniture.get(id);
      return v?.swing && !v.away ? { swing: v.swing, x: v.piece.x, z: v.piece.z, rotY: v.piece.rotY } : undefined;
    },
    rim: (id) => {
      const v = ctx.office.furniture.get(id);
      return v && kindDef(v.piece.kind).top * pieceScale(v.piece);
    },
    person: (id) => (id === store.you ? ctx.player.pos : store.peers.get(id)),
  });
  ctx.scene.add(goat.root);
  // He walks about on his own, not on the building: he's there to aim at by himself.
  ctx.usables.add({ usable: () => goat.interactables, pickable: () => goat.root });
  store.on('goat', () => goat.sync(store.goat, store.goatStart));
  ctx.ticks.add('others', ({ dt }) => goat.update(dt));
  ctx.interactions.define('goat', {
    reach: 3.2,
    hint: () => {
      const doing = goat.doing((id) => (id === store.you ? 'you' : store.peers.get(id)?.name));
      return { k: doing, parts: [hintTitle(`🐐 ${GOAT_NAME}`), doing ? aside(doing) : '', key('E', 'Pet')] };
    },
    use: onE(() => ctx.net.send({ t: 'goat.pet' })),
  });
  return goat;
}
