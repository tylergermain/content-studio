import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:14629/lab/minigolf.html?hole=3&t=1');await page.waitForFunction(()=>window.__ready);
 await page.evaluate(async(root)=>{
  const THREE=await import('/@id/three');const{Putter}=await import('/features/minigolf/controller.ts');const{HOLES}=await import(root+'course.ts');const{teeBall}=await import(root+'physics.ts');
  const style=document.createElement('link');style.rel='stylesheet';style.href='/features/minigolf/ui.css';document.head.append(style);
  const hud=document.createElement('div');hud.id='hud';hud.style.cssText='position:fixed;inset:0;pointer-events:none';document.body.append(hud);
  const hidden=document.createElement('style');hidden.textContent='.hidden{display:none!important}';document.head.append(hidden);
  for(const id of ['modal-root','toasts']){const el=document.createElement('div');el.id=id;document.body.append(el);}
  window.putts=[];const at=teeBall(HOLES[2]);const ball=new THREE.Vector3(at.x,at.y,at.z);
  const player={pos:new THREE.Vector3(),camYaw:0,view:'third',colliders:[],holding:()=>false};const me={setGolf(){},golfBack(){},golfHit(){}};
  window.putter=new Putter(player,me,new THREE.PerspectiveCamera(),{ball:()=>ball,rolling:()=>null,stillUp:()=>true,taken:()=>0,street:()=>0,done(){},stroke:(yaw,power)=>window.putts.push({yaw,power})});
  window.putter.start(2);window.putter.update(1/60);
 }, '/@fs'+fileURLToPath(new URL('../../src/shared/minigolf/',import.meta.url)));
 const before=await page.evaluate(()=>window.putter.aim);
 await page.locator('#c').dispatchEvent('pointermove',{movementX:80,movementY:0});
 if(await page.evaluate(()=>window.putter.aim)===before)throw Error('Unlocked hover did not aim');
 if(await page.evaluate(()=>window.putter.doing)!=='aim')throw Error('Hover started power selection');
 await page.locator('#c').dispatchEvent('pointerdown',{button:0});
 await page.evaluate(()=>{window.dispatchEvent(new PointerEvent('pointermove',{movementY:110,movementX:100}));window.putter.update(1/60);});
 if(await page.evaluate(()=>window.putter.power)!==0.5)throw Error('Mouse power incorrect');
 await page.screenshot({path:'/tmp/mini-golf-arcade.png'});
 await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'})));
 if(await page.evaluate(()=>window.putts.length)!==0)throw Error('Space released mouse charge');
 await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerup',{button:0})));
 if(await page.evaluate(()=>window.putts[0].power)!==0.5)throw Error('Incorrect sent power');
 await page.evaluate(()=>{window.putter.stop();window.putter.start(2);});
 await page.locator('#c').dispatchEvent('pointerdown',{button:0});await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 if(await page.evaluate(()=>window.putter.doing)!=='aim')throw Error('Blur did not cancel');
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.putter.update(1/60));await page.screenshot({path:'/tmp/mini-golf-mobile.png'});
 if(await page.locator('.putt-meter').evaluate(e=>e.getBoundingClientRect().right>innerWidth))throw Error('Mobile HUD overflow');
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS unlocked hover aiming, mouse power, shot release, keyboard isolation, blur cancellation, rendered course and mobile HUD');
} finally {await browser.close();}
