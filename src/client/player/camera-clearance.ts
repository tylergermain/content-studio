import type { Collider } from '../world/types';
interface Point { x:number; y:number; z:number }
/** Retract a camera boom at the first solid box, including clearance for the near clipping plane. */
export function clearCamera<T extends Point>(target: Point, camera: T, colliders: readonly Collider[], radius=0.22): T {
 const dx=camera.x-target.x,dy=camera.y-target.y,dz=camera.z-target.z;
 const length=Math.hypot(dx,dy,dz);if(length<0.001)return camera;
 let limit=1;
 for(const box of colliders) {
  const bounds=[[box.minX-radius,box.maxX+radius],[ (box.bottom??0)-radius,box.top+radius],[box.minZ-radius,box.maxZ+radius]];
  const start=[target.x,target.y,target.z],delta=[dx,dy,dz];
  // A target on a solid prop may be inside its coarse walking box. That box cannot define a boom.
  if(bounds.every(([lo,hi],i)=>start[i]>lo&&start[i]<hi))continue;
  let enter=0,exit=1;
  for(let i=0;i<3;i++) {
   const [lo,hi]=bounds[i];
   if(Math.abs(delta[i])<1e-9){if(start[i]<lo||start[i]>hi){exit=-1;break;}continue;}
   const a=(lo-start[i])/delta[i],b=(hi-start[i])/delta[i];
   enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
  }
  if(enter<=exit&&exit>=0&&enter<=1)limit=Math.min(limit,Math.max(0,enter-0.04/length));
 }
 camera.x=target.x+dx*limit;camera.y=target.y+dy*limit;camera.z=target.z+dz*limit;
 return camera;
}
