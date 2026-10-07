import type { Ctx } from '../../core/context';
import { textPlane } from '../../world/toon';
import { store } from '../../state';
import { skillLibraryFloor } from '../../../shared/skill-library';
import type { Mesh, Material } from 'three';

/** The same shelf becomes a skill library only on AI Innovators. */
export function mountSkillLibrarySign(ctx: Ctx) {
 // Looked for again only when the floor, its furniture or the label changes (or every couple of seconds): not the whole office every frame.
 let looked='';let lookedAt=-Infinity;
 ctx.ticks.add('world',({now})=>{
  const label=skillLibraryFloor(store.floor)?'📚 Skill library':'📚 Docs';
  const key=`${store.floor}|${label}|${ctx.office.furniture.version}`;
  if(key===looked&&now-lookedAt<2000)return;
  looked=key;lookedAt=now;
  ctx.office.group.traverse(object=>{
   if(object.userData.bookshelfLabel===undefined||object.userData.bookshelfLabel===label)return;
   const old=object as Mesh;
   const fresh=textPlane(label,{size:40,bg:'#fffaf3'});
   old.geometry.dispose();(Array.isArray(old.material)?old.material:[old.material]).forEach((m:Material)=>{if('map' in m)(m.map as {dispose():void}|null)?.dispose();m.dispose();});
   old.geometry=fresh.geometry;old.material=fresh.material;old.userData.bookshelfLabel=label;
  });
 });
}
