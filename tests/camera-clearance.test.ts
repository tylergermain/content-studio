import test from 'node:test';
import assert from 'node:assert/strict';
import {clearCamera} from '../src/client/player/camera-clearance.js';
const box={minX:-1,maxX:1,minZ:2,maxZ:3,bottom:0,top:4};
test('camera retracts before obstacles, even if its final position was beyond them',()=>{
 const at=clearCamera({x:0,y:1,z:0},{x:0,y:1,z:5},[box]);assert.ok(at.z<1.78&&at.z>1.6);
});
test('camera can pass above a low obstacle and returns to its full distance when clear',()=>{
 assert.equal(clearCamera({x:0,y:5,z:0},{x:0,y:5,z:5},[box]).z,5);
 assert.equal(clearCamera({x:0,y:1,z:0},{x:0,y:1,z:5},[]).z,5);
});
test('the nearest obstruction wins, and parallel rays outside the box remain clear',()=>{
 const farther={...box,minZ:4,maxZ:5};assert.ok(clearCamera({x:0,y:1,z:0},{x:0,y:1,z:8},[farther,box]).z<1.78);
 assert.equal(clearCamera({x:3,y:1,z:0},{x:3,y:1,z:8},[box]).z,8);
});
