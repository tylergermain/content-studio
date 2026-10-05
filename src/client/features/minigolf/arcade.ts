/** Mouse pull-back power, independent of cursor position so pointer lock works too. */
export function pullPower(power: number, pixels: number): number {
  return Math.max(0, Math.min(1, power + pixels / 220));
}
