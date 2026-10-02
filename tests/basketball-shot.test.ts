import test from 'node:test';
import assert from 'node:assert/strict';
import { dunkRelease, physicalThrow, throwCharge } from '../src/shared/basketball-shot.js';
import { BALL, HOOP, WIND_UP, idealSpeed, launch, simulate, backboard, throwOk } from '../src/shared/hoop.js';

test('charge grows continuously and stays too hard after a long hold', () => {
 assert.equal(throwCharge(0),0);assert.equal(throwCharge(WIND_UP/2),.5);
 assert.equal(throwCharge(WIND_UP),1);assert.equal(throwCharge(WIND_UP*4),1);
 const from={x:HOOP.rim.x+2,y:2,z:HOOP.rim.z};
 assert.equal(physicalThrow(from,-Math.PI/2,.7,0).vy,0);
 assert.ok(physicalThrow(from,-Math.PI/2,.7,.2).vy<physicalThrow(from,-Math.PI/2,.7,.5).vy);
});
test('release preserves its origin and exact aim instead of moving to the basket', () => {
 const from={x:HOOP.rim.x+5,y:2,z:HOOP.rim.z+3};
 const shot=physicalThrow(from,0,0,WIND_UP/2);
 assert.deepEqual(shot,{...from,vx:0,vy:0,vz:BALL.maxSpeed/2});assert.ok(throwOk(shot));
 const down=physicalThrow(from,0,-.5,WIND_UP/2);assert.ok(down.vy<0);
});
test('a physically timed close shot can go in, while an uncharged release drops short', () => {
 const from={x:HOOP.rim.x+2,y:2,z:HOOP.rim.z};const pitch=1.1;
 const speed=idealSpeed(from,pitch)!;
 const good=launch(physicalThrow(from,-Math.PI/2,pitch,speed/BALL.maxSpeed*WIND_UP));simulate(good,1.5,[backboard()]);assert.ok(good.scored);
 const weak=launch(physicalThrow(from,-Math.PI/2,pitch,0));simulate(weak,1.5,[backboard()]);assert.equal(weak.scored,false);
});
test('a dunk label requires an airborne downward release genuinely above and beside the rim', () => {
 const from={x:HOOP.rim.x,y:HOOP.rim.y+BALL.r+.1,z:HOOP.rim.z};
 assert.ok(dunkRelease(from,false,-.5));assert.equal(dunkRelease(from,true,-.5),false);
 assert.equal(dunkRelease({...from,y:2},false,-.5),false);
 assert.equal(dunkRelease({...from,x:from.x+1},false,-.5),false);
 assert.equal(dunkRelease(from,false,.5),false);
 const sim=launch(physicalThrow(from,0,-Math.PI/2,.1));simulate(sim,.4,[backboard()]);assert.ok(sim.scored);
});
