/**
 * How long a wall that goes up to the ceiling is ('tall-wall', 'tall-glass': see KindDef.long), in the builder's
 * inspector (see ui.ts): a slider in meters, kept on the piece as its `w`. A longer wall that's in the way of
 * something is refused, as moving it would be.
 */
import { pieceLength, type Piece } from '../../../shared/furniture';
import { h } from '../../ui/dom';

export function lengthUi(piece: Piece, range: readonly [number, number], edit: (patch: Partial<Piece>) => void, fixed: boolean): HTMLElement {
  const value = pieceLength(piece);
  const says = h('output', {}, `${value.toFixed(2)} m`);
  const input = h('input', { type: 'range', min: range[0], max: range[1], step: 0.05, disabled: fixed }) as HTMLInputElement;
  input.value = String(value);
  input.addEventListener('input', () => (says.textContent = `${input.valueAsNumber.toFixed(2)} m`));
  input.addEventListener('change', () => edit({ w: input.valueAsNumber }));
  return h('label.ob-field', {}, h('span.ob-measure', {}, 'Long', says), input);
}
