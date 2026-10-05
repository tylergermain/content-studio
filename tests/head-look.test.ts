import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanHead,lookFromDirection} from '../src/shared/head-look.js';
import {vrHandlers} from '../src/server/ws/handlers/vr.js';
test('head direction is relative to body and wraps correctly across north',()=>{
 assert.ok(Math.abs(lookFromDirection(1,0,0,0).yaw-Math.PI/2)<0.001);
 assert.ok(Math.abs(lookFromDirection(0,0,1,2*Math.PI).yaw)<0.001);
 assert.equal(lookFromDirection(0,0.5,1,0).pitch,Math.asin(0.5));
});
test('invalid head poses are rejected and valid turns remain within neck limits',()=>{
 assert.equal(cleanHead({yaw:NaN,pitch:0}),null);
 assert.equal(cleanHead({yaw:0,pitch:'1'}),null);
 assert.deepEqual(cleanHead({yaw:9,pitch:-4}),{yaw:1.65,pitch:-0.9});
});
test('head movement is broadcast across floors for helicopter figures, with throttling',()=>{
 const sent:unknown[]=[];const ctx={broadcast:(...args:unknown[])=>sent.push(args)};const client={id:'pilot',throttles:new Map()};
 // Use the handler's existing per-client throttle storage.
 vrHandlers['head.look'](ctx as never,client as never,{t:'head.look',look:{yaw:1,pitch:0}});
 assert.equal(sent.length,1);
 vrHandlers['head.look'](ctx as never,client as never,{t:'head.look',look:{yaw:1,pitch:0}});
 assert.equal(sent.length,1);
});
