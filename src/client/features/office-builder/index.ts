import type { Ctx } from '../../core/context';
import { DESKS, DESK_SIZE, deskSeat } from '../../../shared/layout';
import { ORIGINAL_DESKS, deskRect } from '../../../shared/office-builder';
import { clearOfficeNav, officeNav } from '../../../shared/nav';
import { store } from '../../state';
import { openOfficeBuilder } from './ui';

export function installOfficeBuilder(ctx: Ctx) {
  const bindings = ORIGINAL_DESKS.map(d => ({ original:d, view:ctx.office.desks.get(d.id)!, collider:ctx.office.colliders.find(c=>Math.abs(c.minX-(d.x-DESK_SIZE.width/2+0.05))<0.001 && Math.abs(c.minZ-(d.z-DESK_SIZE.depth/2+0.02))<0.001 && c.top===DESK_SIZE.height) }));
  const sync=()=>{
    for(const b of bindings){
      const pose=store.floorPlan.desks?.[b.original.id] ?? b.original;
      const d=DESKS.find(d=>d.id===b.original.id)!;
      Object.assign(d,{x:pose.x,z:pose.z,rotY:pose.rotY});
      Object.assign(b.view.def,{x:pose.x,z:pose.z,rotY:pose.rotY});
      b.view.group.position.set(d.x,0,d.z); b.view.group.rotation.y=d.rotY;
      if(b.collider){const box=deskRect(d); Object.assign(b.collider,box);}
      const it=ctx.office.interactables.find(i=>i.kind==='desk' && i.deskId===d.id);
      if(it){const at=deskSeat(d,1.25);it.x=at.x;it.z=at.z;}
      const sign=ctx.office.signs.get(d.id);if(sign){sign.position.set(d.x,0,d.z);sign.rotation.y=d.rotY;}
    }
    clearOfficeNav();
    if (store.map.pick === 'office' && ctx.player.pos.y > -0.1 && ctx.player.pos.y < DESK_SIZE.height) {
      const p = ctx.player.pos;
      for (const b of bindings) {
        const c = b.collider;
        if (c && p.x > c.minX - 0.3 && p.x < c.maxX + 0.3 && p.z > c.minZ - 0.3 && p.z < c.maxZ + 0.3) {
          const at = officeNav(store.floorPlan.wing).nearestWalkable([p.x, p.z]);
          p.x = at[0]; p.z = at[1]; break;
        }
      }
    }
  };
  store.on('floorPlan',sync);
  ctx.keys.bind({code:'KeyB',when:()=>store.me.admin && !!store.floor && store.map.pick==='office',run:()=>{openOfficeBuilder(ctx.net);}});
  return { sync };
}
