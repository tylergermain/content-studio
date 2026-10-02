import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateLayout, layoutDesks, deskRect, ORIGINAL_DESKS } from '../src/shared/office-builder.js';
import { FloorPlanStore } from '../src/server/floorplan.js';
import { officeNav } from '../src/shared/nav.js';

test('builder accepts original layout and rejects invalid coordinates, furniture collisions, and unknown seats',()=>{
  assert.deepEqual(validateLayout({}),{});
  assert.equal(typeof validateLayout({'desk-1':{x:NaN,z:0,rotY:0}}),'string');
  assert.equal(typeof validateLayout({'desk-1':{x:0,z:0,rotY:0.4}}),'string');
  assert.equal(typeof validateLayout({'desk-1':{x:40,z:0,rotY:0}}),'string');
  assert.equal(typeof validateLayout({'desk-1':{...ORIGINAL_DESKS[1]}}),'string');
  assert.equal(typeof validateLayout({'desk-1':{x:-6,z:0,rotY:0}}),'string');
  assert.equal(typeof validateLayout({'station-queue':{x:0,z:0,rotY:0}}),'string');
});

test('layouts persist, preserve labels and expansion, detect conflicts and protect occupied desks',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'content-studio-builder-'));
  try{
    const p=new FloorPlanStore(dir);p.expand();p.label('desk-1','Research',undefined,'Tyler');
    const desks={'desk-1':{x:-6.75,z:-6.75,rotY:0}};
    assert.equal(p.layout(desks,0,()=>false),undefined);
    assert.equal(p.state().layoutRevision,1);
    const reloaded=new FloorPlanStore(dir);
    assert.deepEqual(reloaded.state().desks,desks);
    assert.equal(reloaded.state().wing,1);
    assert.equal(reloaded.state().labels['desk-1'].text,'Research');
    assert.match(p.layout({},0,()=>false)!,/changed/);
    assert.match(p.layout({},1,()=>true)!,/worker/);
    const copy=p.state();copy.desks!['desk-1'].x=500;assert.equal(p.state().desks!['desk-1'].x,-6.75);
    assert.equal(p.layout({},1,()=>false),undefined);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('rotated desks and navigation use the saved geometry independently per floor',()=>{
  const pose={x:-6.75,z:-6.75,rotY:Math.PI/2};const rect=deskRect(pose);
  assert.ok(Math.abs(rect.maxX-rect.minX-1.1)<0.001);
  assert.ok(Math.abs(rect.maxZ-rect.minZ-2.2)<0.001);
  const custom=officeNav(0,layoutDesks({'desk-1':pose}));
  assert.equal(custom.walkable(pose.x,pose.z),false);
  assert.equal(officeNav(0).walkable(-6.75,-6.75),true);
});
