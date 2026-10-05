// The lounge's coffee table takes paint like the rest of the furniture (shared/furniture.ts), so a floor
// can have a walnut one; a floor that never painted its own keeps the old one's wood.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FURNITURE, FURNITURE, cleanFurniture, type Piece } from '../src/shared/furniture.js';

/** The old coffee table's top (LOUNGE_COLORS.Wood in client/world/office/props.ts, PALETTE.wood). */
const OLD_WOOD = '#c98b5a';

test('the coffee table is painted its own color, and one that was never painted keeps the old wood', () => {
  assert.equal(FURNITURE['coffee-table'].color, OLD_WOOD);
  const [walnut, plain, bad] = cleanFurniture([
    { id: 'walnut', kind: 'coffee-table', x: 0, z: 0, rotY: 0, color: '#7A5236' },
    { id: 'plain', kind: 'coffee-table', x: 2, z: 0, rotY: 0 },
    { id: 'bad', kind: 'coffee-table', x: 4, z: 0, rotY: 0, color: 'walnut' },
  ]) as Piece[];
  assert.equal(walnut.color, '#7a5236');
  assert.equal(plain.color, OLD_WOOD, 'a saved floor whose table said nothing looks as it did');
  assert.equal(bad.color, OLD_WOOD);
  assert.equal(DEFAULT_FURNITURE.find((p) => p.kind === 'coffee-table')?.color, OLD_WOOD, "the office's own lounge is unchanged");
});
