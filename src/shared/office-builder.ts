import { DESKS, DESK_SIZE, PLANTS, type DeskDef } from './layout.js';

export interface DeskPose { x: number; z: number; rotY: number }
export type DeskLayout = Record<string, DeskPose>;
// Keep the original floor plan even when a browser moves its shared desk definitions.
export const ORIGINAL_DESKS: readonly DeskDef[] = DESKS.map(d => ({ ...d }));
export const BUILD_AREA = { minX: -14.5, maxX: 3, minZ: -8, maxZ: 8 };
export const SNAP = 0.25;
export function deskRect(p: DeskPose, chair = false) {
  const halfX = DESK_SIZE.width / 2;
  const minZ = -DESK_SIZE.depth / 2, maxZ = chair ? 1.4 : DESK_SIZE.depth / 2;
  const points = [[-halfX,minZ],[halfX,minZ],[-halfX,maxZ],[halfX,maxZ]].map(([x,z]) =>
    [p.x + x * Math.cos(p.rotY) + z * Math.sin(p.rotY), p.z - x * Math.sin(p.rotY) + z * Math.cos(p.rotY)]);
  return { minX: Math.min(...points.map(p=>p[0])), maxX: Math.max(...points.map(p=>p[0])), minZ: Math.min(...points.map(p=>p[1])), maxZ: Math.max(...points.map(p=>p[1])) };
}
export function layoutDesks(layout: DeskLayout = {}): DeskDef[] {
  return ORIGINAL_DESKS.map(d => ({ ...d, ...layout[d.id] }));
}
export function validateLayout(raw: unknown): DeskLayout | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Choose a valid desk layout';
  const entries = Object.entries(raw);
  if (entries.length > ORIGINAL_DESKS.length) return 'Too many desks in this layout';
  const layout: DeskLayout = {};
  for (const [id, value] of entries) {
    if (!ORIGINAL_DESKS.some(d=>d.id===id) || !value || typeof value!=='object') return 'Only the main office desks can be moved';
    const p = value as DeskPose;
    if (![p.x,p.z,p.rotY].every(n=>typeof n==='number' && Number.isFinite(n))) return 'Desk coordinates must be finite numbers';
    const quarter = Math.round(p.rotY/(Math.PI/2));
    if (Math.abs(p.rotY-quarter*Math.PI/2)>0.001) return 'Rotate desks in quarter turns';
    layout[id]={x:Math.round(p.x/SNAP)*SNAP,z:Math.round(p.z/SNAP)*SNAP,rotY:((quarter%4+4)%4)*Math.PI/2};
  }
  const desks=layoutDesks(layout);
  for (const d of desks) {
    const a=deskRect(d,true);
    if (a.minX<BUILD_AREA.minX || a.maxX>BUILD_AREA.maxX || a.minZ<BUILD_AREA.minZ || a.maxZ>BUILD_AREA.maxZ) return `${d.label} must stay inside the editable work area`;
    for (const [x,z,scale] of PLANTS) if (x>a.minX-0.3*scale && x<a.maxX+0.3*scale && z>a.minZ-0.3*scale && z<a.maxZ+0.3*scale) return `${d.label} needs more space from a plant`;
    for (const other of desks) {
      if(other.id===d.id)continue;
      const b=deskRect(other,true);
      if(a.minX<b.maxX-0.02 && a.maxX>b.minX+0.02 && a.minZ<b.maxZ-0.02 && a.maxZ>b.minZ+0.02) return `${d.label} overlaps ${other.label} or its chair`;
    }
  }
  return layout;
}
