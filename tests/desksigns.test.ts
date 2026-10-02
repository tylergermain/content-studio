import test from 'node:test';
import assert from 'node:assert/strict';
import { signThroughDeck } from '../src/client/world/desksigns.js';
import { DESKS, DESK_SIZE } from '../src/shared/layout.js';
import { BIG } from '../src/shared/mezzanine.js';

test('a desk’s hanging sign is put away where it would come through the floor upstairs', () => {
  const big = { mezzanine: 'big' } as const;
  // Under the big mezzanine, whichever way the desk is turned.
  for (const rotY of [0, Math.PI / 2, Math.PI]) assert.equal(signThroughDeck(big, { x: -7, z: 9.5, rotY }), true);
  // The same desk on a floor that's all one level, or with only the corner loft, keeps its sign.
  assert.equal(signThroughDeck({ mezzanine: 'none' }, { x: -7, z: 9.5, rotY: 0 }), false);
  assert.equal(signThroughDeck({}, { x: -7, z: 9.5, rotY: 0 }), false);
  // Under the corner loft it goes too.
  assert.equal(signThroughDeck({}, { x: 12, z: 10, rotY: 0 }), true);
  assert.equal(signThroughDeck({ mezzanine: 'none' }, { x: 12, z: 10, rotY: 0 }), false);
});

test('the sign goes by where its board hangs, off the desk’s far edge, as well as by the desk', () => {
  const big = { mezzanine: 'big' } as const;
  const edge = BIG.minZ;
  // A desk just north of the deck whose far edge is under it: the board would be in the rail.
  assert.equal(signThroughDeck(big, { x: 0, z: edge - 0.3, rotY: Math.PI }), true);
  // Turned the other way, its board hangs out in the open.
  assert.equal(signThroughDeck(big, { x: 0, z: edge - 0.3, rotY: 0 }), false);
  // A desk under the deck's edge with its board out past the rail still loses it: the desk is under the deck.
  assert.equal(signThroughDeck(big, { x: 0, z: edge + DESK_SIZE.depth / 2 - 0.1, rotY: 0 }), true);
});

test('no desk where the office puts it loses its sign, on any kind of floor', () => {
  for (const room of [{}, { mezzanine: 'none' }, { mezzanine: 'big' }, { boss: false }] as const) {
    assert.deepEqual(DESKS.filter((d) => signThroughDeck(room, d)).map((d) => d.id), [], JSON.stringify(room));
  }
});
