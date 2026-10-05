import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:900,height:650}});
 await page.route('**/head-test',r=>r.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><canvas id="c"></canvas></body></html>'}));
 await page.goto('http://127.0.0.1:14630/head-test');
 await page.evaluate(async()=>{
  const THREE=await import('/@id/three');const{Person}=await import('/world/character/person.ts');const{stage}=await import('/lab/stage.ts');const{installHeadLook}=await import('/features/head-look/index.ts');
  const s=stage(document.querySelector('canvas'));const person=new Person('Passenger','#59bffa');person.sit(0.45);person.update(1/60,0,false,false);s.scene.add(person.root);
  const probe=new THREE.Object3D();person.wear(probe,'head');const handlers={},ticks={};const outgoing=[];
  const camera=new THREE.PerspectiveCamera();camera.rotation.y=-Math.PI/2;
  installHeadLook({messages:{on:(key,fn)=>handlers[key]=fn},ticks:{add:(key,fn)=>ticks[key]=fn},renderer:{xr:{isPresenting:false}},camera,player:{facing:0},net:{send:m=>outgoing.push(m)}},{peers:{remotes:new Map([['passenger',{person}]])}});
  ticks.hud({now:performance.now()});if(Math.abs(outgoing[0].look.yaw-Math.PI/2)>0.01)throw Error('Wrong outgoing head direction');
  handlers['peer.head']({id:'passenger',look:{yaw:1.2,pitch:0.2}});ticks.others({dt:1/60});
  if(Math.abs(probe.parent.rotation.y-1.2)>0.05)throw Error('Remote head did not turn');
  s.camera.position.set(3,2.3,5);s.camera.lookAt(0,1,0);s.render();
 });
 await page.screenshot({path:'/tmp/shared-head-look.png'});console.log('PASS desktop look sending and remote head rotation');
} finally {await browser.close();}
