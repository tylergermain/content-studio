import {chromium} from 'playwright-core';
import {squareCrop} from '../../src/client/features/webcam/logic.ts';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{const page=await browser.newPage({viewport:{width:700,height:380}});await page.setContent('<body style="background:#172d36;color:white;font:18px system-ui"><p>Tighter centered webcam crop</p><canvas width="600" height="280"></canvas></body>');await page.evaluate(crop=>{
 const source=document.createElement('canvas');source.width=640;source.height=480;const s=source.getContext('2d');s.fillStyle='#738eac';s.fillRect(0,0,640,480);s.fillStyle='#e6b28c';s.beginPath();s.ellipse(320,240,85,110,0,0,Math.PI*2);s.fill();s.fillStyle='#172d36';s.fillRect(280,215,15,12);s.fillRect(345,215,15,12);s.fillRect(300,280,40,8);
 const g=document.querySelector('canvas').getContext('2d');g.drawImage(source,0,0,640,480,0,0,300,225);g.drawImage(source,crop.offset[0]*640,crop.offset[1]*480,crop.repeat[0]*640,crop.repeat[1]*480,320,0,240,240);
 },squareCrop(640,480,false));await page.screenshot({path:'/tmp/webcam-tight-crop.png'});console.log('PASS rendered centered face crop');}finally{await browser.close();}
