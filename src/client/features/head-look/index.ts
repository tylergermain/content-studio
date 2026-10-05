import * as THREE from 'three';
import { lookFromDirection, type HeadLook } from '../../../shared/head-look';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import type { Person } from '../../world/character';
const poses=new Map<string,{look:HeadLook;at:number}>();
const vr=new Set<string>();
const turns=new WeakMap<Person,THREE.Quaternion>();
const markers=new WeakMap<Person,THREE.Object3D>();
const rotation=new THREE.Euler(0,0,0,'YXZ');
const want=new THREE.Quaternion();
/** Runs after the seated/walking pose, including cross-floor helicopter passenger figures. */
export function showHead(id:string,person:Person,dt:number) {
 const pose=poses.get(id);if(!pose||performance.now()-pose.at>2500||vr.has(id))return;
 want.setFromEuler(rotation.set(-pose.look.pitch,pose.look.yaw,0,'YXZ'));
 let turn=turns.get(person);if(!turn){turn=want.clone();turns.set(person,turn);}else turn.slerp(want,1-Math.exp(-18*dt));
 let marker=markers.get(person);if(!marker){marker=new THREE.Object3D();person.wear(marker,'head');markers.set(person,marker);}
 marker.parent?.quaternion.premultiply(turn);
}
export function installHeadLook(ctx:Ctx,parts:Pick<Parts,'peers'>) {
 const direction=new THREE.Vector3();let sent=-Infinity,last:HeadLook|null=null;
 ctx.messages.on('peer.head',m=>poses.set(m.id,{look:m.look,at:performance.now()}));
 ctx.messages.on('peer.vr',m=>{if(m.pose)vr.add(m.id);else vr.delete(m.id);});
 ctx.ticks.add('hud',({now})=>{
  if(ctx.renderer.xr.isPresenting||now-sent<120)return;
  ctx.camera.getWorldDirection(direction);
  const look=lookFromDirection(direction.x,direction.y,direction.z,ctx.player.facing);
  if(last&&now-sent<1000&&Math.abs(last.yaw-look.yaw)<0.025&&Math.abs(last.pitch-look.pitch)<0.025)return;
  ctx.net.send({t:'head.look',look});last=look;sent=now;
 });
 ctx.ticks.add('others',({dt})=>{
  for(const[id,r]of parts.peers.remotes)showHead(id,r.person,dt);
  for(const[id,p]of poses)if(performance.now()-p.at>2500)poses.delete(id);
 });
}
