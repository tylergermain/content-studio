// Run against Vite: STUDIO_TEST_URL=http://127.0.0.1:14624 node tests/support/live-greeting-browser.mjs
// Voice is mocked so this check never requests a microphone or bills the API.
import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 await page.route('**/api/worker-chat?**', r=>r.fulfill({json:{liveConfigured:true,messages:[],worker:{name:'Pixel',status:'done'},artifacts:[]}}));
 await page.route('**/greeting-test',r=>r.fulfill({contentType:'text/html',body:'<html><body style="background:#abc"><h1>Office live voice test</h1></body></html>'}));
 await page.goto(`${process.env.STUDIO_TEST_URL ?? 'http://127.0.0.1:14624'}/greeting-test`);
 await page.evaluate(async()=>{
 const source=await (await fetch('/features/workers/live-greeting.ts')).text();
 const threeUrl=source.match(/import \* as THREE from ["']([^"']+)["']/)?.[1];
 if(!threeUrl)throw Error('Vite module could not resolve three');
 const THREE=await import(threeUrl);
 const {installLiveGreeting}=await import('/features/workers/live-greeting.ts');
 const {WorkerLive}=await import('/ui/worker-chat/live.ts');
 const {store}=await import('/state/index.ts');
 let starts=0,stops=0,carrying=false;WorkerLive.prototype.start=async function(){starts++;this.starting=true;};WorkerLive.prototype.update=function(){};WorkerLive.prototype.stop=function(){stops++;this.starting=false;};
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,.1,20);camera.updateMatrixWorld();
 const root=new THREE.Group();root.position.z=-2;const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());root.add(mesh);scene.add(root);scene.updateMatrixWorld(true);
 const views=new Map([['pixel',{model:{root,walking:false}}]]);store.workers.set('pixel',{id:'pixel',name:'Pixel',kind:'agent'});
 let key,tick;const ctx={scene,camera,player:{pos:new THREE.Vector3(1,0,0)},keys:{add(stage,fn){key=fn;}},ticks:{add(stage,fn){tick=fn;}},carrying:()=>carrying,activities:{busy:()=>false}};
 installLiveGreeting(ctx,views);const press=(code,repeat=false)=>key({code,repeat,preventDefault(){}});
 carrying=true;if(press('KeyQ'))throw Error('Q intercepted carried card');carrying=false;
 const wall=new THREE.Mesh(new THREE.BoxGeometry(2,2,.1),new THREE.MeshBasicMaterial());wall.position.z=-1;scene.add(wall);scene.updateMatrixWorld(true);if(press('KeyQ'))throw Error('Q talks through wall');scene.remove(wall);
 if(!press('KeyQ'))throw Error('Q did not select agent');await new Promise(r=>setTimeout(r,250));if(starts!==1)throw Error('Voice did not start');
 press('KeyQ',true);if(!document.querySelector('.live-greeting'))throw Error('Repeat closed voice');
 tick({dt:.5,now:0});if(root.rotation.y<.4)throw Error('Agent did not turn toward player');
 window.greeting={press,tick,root,ctx,get starts(){return starts;},get stops(){return stops;}};
 });
 await page.screenshot({path:'/tmp/agent-live-greeting-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/agent-live-greeting-phone.png'});
 await page.evaluate(async()=>{const g=window.greeting;g.press('Escape');if(document.querySelector('.live-greeting')||g.root.rotation.y!==0||g.stops!==1)throw Error('Esc did not restore');g.press('KeyQ');await new Promise(r=>setTimeout(r,100));g.ctx.player.pos.set(10,0,0);g.tick({dt:.1,now:100});if(document.querySelector('.live-greeting')||g.stops!==2)throw Error('Walk away did not end voice');});
 console.log('PASS Q selection, wall occlusion, card priority, repeat handling, facing, Esc restoration and distance cleanup; desktop and phone screenshots');
}finally{await browser.close();}
