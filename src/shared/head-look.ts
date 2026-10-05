export interface HeadLook { yaw:number; pitch:number }
export function cleanHead(value: unknown): HeadLook | null {
 if(!value||typeof value!=='object')return null;
 const {yaw,pitch}=value as HeadLook;
 if(!Number.isFinite(yaw)||!Number.isFinite(pitch))return null;
 return {yaw:Math.max(-1.65,Math.min(1.65,yaw)),pitch:Math.max(-0.9,Math.min(0.9,pitch))};
}
export function lookFromDirection(x:number,y:number,z:number,facing:number):HeadLook {
 const yaw=Math.atan2(x,z)-facing;
 return cleanHead({yaw:Math.atan2(Math.sin(yaw),Math.cos(yaw)),pitch:Math.asin(Math.max(-1,Math.min(1,y)))})!;
}
