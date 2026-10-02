// Run against Vite with STUDIO_TEST_URL, default http://127.0.0.1:14627.
import { chromium } from 'playwright-core';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1000,height:700}});
 await page.route('**/shot-test',r=>r.fulfill({contentType:'text/html',body:'<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="shot-meter"></div><div id="toasts"></div><div id="dunk-hint" style="position:fixed;bottom:35px;left:25%;z-index:2;background:#fff;padding:20px;border-radius:15px"></div></body></html>'}));
 await page.goto(`${process.env.STUDIO_TEST_URL ?? 'http://127.0.0.1:14627'}/shot-test`);
 await page.evaluate(async()=>{
  const source=await(await fetch('/features/basketball/index.ts')).text();
  const THREE=await import(source.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
  const{installBasketball}=await import('/features/basketball/index.ts');const{buildHoop}=await import('/features/basketball/world.ts');const{HOOP}=await import(source.match(/from ["']([^"']*\/hoop\.ts[^"']*)["']/)[1]);const{store}=await import('/state/index.ts');
  const hoop=buildHoop(),group=new THREE.Group();group.add(hoop.group);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#d3e1eb');scene.add(group,new THREE.AmbientLight('white',2));
  const camera=new THREE.PerspectiveCamera(45,1000/700,.1,50);camera.position.set(HOOP.rim.x+5,4,HOOP.rim.z+4);camera.lookAt(HOOP.rim.x,2.5,HOOP.rim.z);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1000,700);document.body.append(renderer.domElement);
  let key,confetti=0;const throws=[];let time=100;performance.now=()=>time;const ctx={office:{group,colliders:[],hoop},camera,player:{pos:new THREE.Vector3(HOOP.rim.x+1,.95,HOOP.rim.z),grounded:false,view:'first'},net:{send(m){if(m.t==='ball.throw')throws.push(m);}},hint:{invalidate(){}},sound:{ball(){}},carrying:()=>null,inOffice:()=>true,upTop:()=>false,usables:{add(){}},windowOpened:{add(){}},messages:{on(){}},interactions:{define(){}},keys:{add(_stage,fn){key=fn;}},ticks:{add(){}},hands:{shoot(){}},me:{shoot(){}},confetti:{burst(){confetti++;}}};
  store.you='player';store.profile.color='#ff8655';store.ball={holder:'player'};
  const api=installBasketball(ctx,{remotes:new Map(),reach(){}});api.ballNews(false);
  const hint=api.ballHint();document.getElementById('dunk-hint').append(...hint.parts.filter(Boolean));
  if(key({code:'Space',repeat:false,preventDefault(){}})||throws.length)throw Error('Space still performs assisted dunk');
  ctx.player.camYaw=Math.PI/2;ctx.player.lookPitch=.8;camera.position.set(HOOP.rim.x+2,2,HOOP.rim.z);
  api.windUp();time+=50;api.letFly();const weak=throws.at(-1);if(!weak||Math.hypot(weak.vx,weak.vy,weak.vz)>1)throw Error('Quick release too strong');
  store.ball={holder:'player'};api.ballNews(false);api.windUp();time+=1500;api.letFly();const hard=throws.at(-1);if(Math.hypot(hard.vx,hard.vy,hard.vz)<15.9)throw Error('Long hold lost power');
  if(hard.x===HOOP.rim.x||hard.y===HOOP.rim.y+.27)throw Error('Release snapped to rim');
  store.ball={holder:'player'};api.ballNews(false);ctx.player.lookPitch=1.1;
  const{idealSpeed,WIND_UP,BALL}=await import(source.match(/from ["']([^"']*\/hoop\.ts[^"']*)["']/)[1]);
  const from={x:camera.position.x-Math.cos(1.1)*.3,y:camera.position.y+Math.sin(1.1)*.3,z:camera.position.z};
  const held=idealSpeed(from,1.1)/BALL.maxSpeed*WIND_UP;
  api.windUp();time+=held*1000;api.letFly();api.ball.update(time+1200,()=>null);
  camera.position.set(HOOP.rim.x+5,4,HOOP.rim.z+4);camera.lookAt(HOOP.rim.x,2.5,HOOP.rim.z);renderer.render(scene,camera);
  if(!document.body.textContent.includes('+2'))throw Error('Timed physical layup did not score');
  if(document.body.textContent.includes('DUNK!'))throw Error('Layup incorrectly labeled dunk');
 });
 await page.screenshot({path:'/tmp/studio-physical-shot.png'});
 console.log('PASS Space does not dunk, weak release, long hold saturation, exact launch origin, physical layup, and no false dunk label');
}finally{await browser.close();}
