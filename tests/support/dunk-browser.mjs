// Run against Vite with STUDIO_TEST_URL, default http://127.0.0.1:14626.
import { chromium } from 'playwright-core';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1000,height:700}});
 await page.route('**/dunk-test',r=>r.fulfill({contentType:'text/html',body:'<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="shot-meter"></div><div id="toasts"></div><div id="dunk-hint" style="position:fixed;bottom:35px;left:25%;z-index:2;background:#fff;padding:20px;border-radius:15px"></div></body></html>'}));
 await page.goto(`${process.env.STUDIO_TEST_URL ?? 'http://127.0.0.1:14626'}/dunk-test`);
 await page.evaluate(async()=>{
  const source=await(await fetch('/features/basketball/index.ts')).text();
  const THREE=await import(source.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
  const{installBasketball}=await import('/features/basketball/index.ts');const{buildHoop}=await import('/features/basketball/world.ts');const{HOOP}=await import(source.match(/from ["']([^"']*\/hoop\.ts[^"']*)["']/)[1]);const{store}=await import('/state/index.ts');
  const hoop=buildHoop(),group=new THREE.Group();group.add(hoop.group);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#d3e1eb');scene.add(group,new THREE.AmbientLight('white',2));
  const camera=new THREE.PerspectiveCamera(45,1000/700,.1,50);camera.position.set(HOOP.rim.x+5,4,HOOP.rim.z+4);camera.lookAt(HOOP.rim.x,2.5,HOOP.rim.z);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1000,700);document.body.append(renderer.domElement);
  let key,throws=0,confetti=0;const ctx={office:{group,colliders:[],hoop},camera,player:{pos:new THREE.Vector3(HOOP.rim.x+1,.95,HOOP.rim.z),grounded:false,view:'first'},net:{send(m){if(m.t==='ball.throw')throws++;}},hint:{invalidate(){}},sound:{ball(){}},carrying:()=>null,inOffice:()=>true,upTop:()=>false,usables:{add(){}},windowOpened:{add(){}},messages:{on(){}},interactions:{define(){}},keys:{add(_stage,fn){key=fn;}},ticks:{add(){}},hands:{shoot(){}},me:{shoot(){}},confetti:{burst(){confetti++;}}};
  store.you='player';store.profile.color='#ff8655';store.ball={holder:'player'};
  const api=installBasketball(ctx,{remotes:new Map(),reach(){}});api.ballNews(false);
  const hint=api.ballHint();if(!hint.parts.some(p=>p.textContent?.includes('Dunk!')))throw Error('Dunk hint missing');document.getElementById('dunk-hint').append(...hint.parts.filter(Boolean));
  const press=repeat=>key({code:'Space',repeat,preventDefault(){}});
  if(!press(true)||throws)throw Error('Repeated Space fired dunk');ctx.player.grounded=true;if(press(false))throw Error('Grounded dunk');ctx.player.grounded=false;
  if(!press(false)||throws!==1)throw Error('Dunk not sent');if(press(false)||throws!==1)throw Error('Dunk repeated without ball');
  api.ball.update(performance.now()+150,()=>null);renderer.render(scene,camera);
  if(!confetti)throw Error('Dunk did not celebrate');
 });
 await page.screenshot({path:'/tmp/studio-dunk.png'});
 console.log('PASS dunk hint, airborne controls, key-repeat guard, synchronized throw, possession release and scoring celebration');
}finally{await browser.close();}
