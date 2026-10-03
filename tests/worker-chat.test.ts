import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, statSync, realpathSync, truncateSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { parseConversation } from '../src/server/worker-chat/transcripts.js';
import { artifactPath, listArtifacts, publicArtifact } from '../src/server/worker-chat/artifacts.js';
import { createLiveSession, saveLiveKey } from '../src/server/worker-chat/live.js';
import { mergeMessages } from '../src/server/worker-chat/history.js';
import { workerChatRoutes } from '../src/server/http/routes/worker-chat.js';
import { sharesRoute } from '../src/server/http/routes/shares.js';
import { displayChatText } from '../src/shared/worker-chat.js';
import type { ChatSnapshot } from '../src/shared/worker-chat.js';

const fixture:ChatSnapshot={worker:{id:'worker1',name:'Creator',provider:'codex',status:'working'},messages:[],artifacts:[],linked:[],source:'waiting',liveConfigured:false,liveAdmin:true,workspace:'files',canSend:true,nearby:[]};
test('session parsing keeps public text across Claude, Codex and Pi while excluding private reasoning and tools',()=>{
 const lines=[{type:'user',timestamp:'2026-10-02T00:00:00Z',message:{role:'user',content:'Make a thumbnail'}},{type:'assistant',message:{role:'assistant',content:[{type:'thinking',thinking:'private chain'},{type:'text',text:'Here is the draft'},{type:'tool_use',input:{secret:'hidden'}}]}},{type:'response_item',payload:{type:'reasoning',summary:[{text:'hidden'}]}},{type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'Codex result'}]}},{type:'message',message:{role:'assistant',content:[{type:'text',text:'Pi result'}]}},{type:'event_msg',payload:{type:'agent_message',message:'Codex result'}}].map(v=>JSON.stringify(v)).join('\n')+'\n{"partial"';
 const messages=parseConversation(lines);assert.deepEqual(messages.map(m=>m.text),['Make a thumbnail','Here is the draft','Codex result','Pi result']);assert.ok(!JSON.stringify(messages).includes('private chain'));assert.ok(!JSON.stringify(messages).includes('secret'));
 const repeated=parseConversation([{message:{role:'user',content:'Again'}},{message:{role:'assistant',content:'Done'}},{message:{role:'user',content:'Again'}},{message:{role:'assistant',content:'Done'}}].map(v=>JSON.stringify(v)).join('\n'));assert.equal(repeated.length,4);
 assert.equal(displayChatText('Follow this live voice request in your current session.\nLatest user request: Make the heading larger\n\nRespond with the result or progress so the voice assistant can report back.'),'Make the heading larger');
});
test('previews reject traversal, hidden authentication state and symlinks outside the worker workspace',async(t)=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'chat-files-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(path.join(root,'outputs'));writeFileSync(path.join(root,'outputs','draft.svg'),'<svg/>');writeFileSync(path.join(root,'.env'),'secret');symlinkSync('/etc',path.join(root,'outputs','outside'));
 assert.equal(publicArtifact('../secret.json'),false);assert.equal(publicArtifact('.claude/auth.json'),false);assert.equal(publicArtifact('credentials.json'),false);assert.equal(await artifactPath(root,'outputs/outside/hosts.txt'),undefined);assert.ok(await artifactPath(root,'outputs/draft.svg'));assert.deepEqual((await listArtifacts(root)).map(f=>f.path),['outputs/draft.svg']);
});
test('GPT-Live session requests use client delegation and keep the API key on the server',async()=>{
 let called=false;const response=await createLiveSession('sk-test-value','v=0\r\n',fixture,async(url,options)=>{called=true;assert.equal(url,'https://api.openai.com/v1/live/sessions');assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer sk-test-value');const body=JSON.parse(options?.body as string);assert.equal(body.session.model,'gpt-live-1');assert.deepEqual(body.session.delegation,{type:'client'});assert.ok(body.session.instructions.includes('Creator'));return new Response(JSON.stringify({session:{id:'live1'},transport:{sdp:'answer'}}),{status:201});});assert.ok(called);assert.equal(response.status,201);assert.ok(!JSON.stringify(response.body).includes('sk-test'));
 const rejected=await createLiveSession('sk-test','v=0',fixture,async()=>new Response('sensitive upstream detail',{status:401}));assert.ok(!JSON.stringify(rejected.body).includes('sensitive'));
});
test('saved voice keys are private and queued chat does not duplicate a matching session message',t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'chat-key-'));t.after(()=>rmSync(root,{recursive:true,force:true}));assert.equal(saveLiveKey(root,'invalid'),false);assert.equal(saveLiveKey(root,'sk-testing-key-12345678'),true);assert.equal(statSync(path.join(root,'gpt-live.json')).mode&0o777,0o600);
 const m={id:'session',role:'user' as const,text:'hello',at:2};assert.equal(mergeMessages([m],[{...m,id:'local'}]).length,1);
});
test('chat HTTP sends into the same worker once, rejects cross-origin writes and gates voice key setup',async(t)=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'chat-route-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let sent:string[]=[];let admin=true;const worker={id:'worker1',kind:'agent',status:'idle',name:'Creator',provider:'pi'};
 const floor={dir:root,workers:{get:()=>worker,prompt:(_id:string,text:string)=>{sent.push(text);},write:()=>{},owners:()=>[{workerId:'worker1',cwd:root}]}};
 const ctx={cfg:{dataDir:root,trustProxy:false},floors:new Map([['floor1',floor]]),meOf:()=>({admin})};
 const server=http.createServer((req,res)=>{const url=new URL(req.url!,'http://localhost');void workerChatRoutes.chat.handle(ctx as never,{req,res,url,path:url.pathname,session:{}}).catch(()=>{res.statusCode=500;res.end();});});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const post=(suffix:string,body:unknown,origin=base)=>fetch(`${base}/api/worker-chat${suffix}?floor=floor1&worker=worker1`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('/message',{text:'Make it warmer',requestId:'request1'})).status,200);assert.equal((await post('/message',{text:'Make it warmer',requestId:'request1'})).status,200);assert.deepEqual(sent,['Make it warmer']);assert.equal((await post('/message',{text:'other',requestId:'request2'},'https://attacker.test')).status,403);assert.equal((await post('/message',{text:'\x1b[bad',requestId:'request3'})).status,400);
 admin=false;assert.equal((await post('/key',{key:'sk-testing-key-12345678'})).status,403);assert.equal((await post('/live',{sdp:'v=0'})).status,403);
});

/**
 * An office with one specialist (a Pi Video Editor hired on the admin's account) whose last message
 * links files, a repository outside the floor holding them, and both HTTP routes, as `caller`.
 */
async function linkOffice(t:{after(fn:()=>void):void},text:string){
 const floorDir=mkdtempSync(path.join(os.tmpdir(),'chat-floor-')),outside=mkdtempSync(path.join(os.tmpdir(),'chat-outside-'));
 t.after(()=>{rmSync(floorDir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});});
 const repo=path.join(outside,'Content OS');mkdirSync(path.join(repo,'.git'),{recursive:true});
 const transcripts=path.join(floorDir,'.agent-office','pi-sessions','worker1');mkdirSync(transcripts,{recursive:true});
 writeFileSync(path.join(transcripts,'session1.jsonl'),JSON.stringify({type:'message',timestamp:'2026-10-03T03:35:42Z',message:{role:'assistant',content:[{type:'text',text:text.replaceAll('REPO',repo)}]}})+'\n');
 const info={id:'worker1',kind:'agent',status:'idle',name:'Video Editor',provider:'pi',sessionId:'session1',specialist:'video-editor',createdAt:1};
 const people=[{id:'admin',role:'admin'},{id:'peer',role:'member'}];
 const floor={dir:floorDir,workers:{get:()=>info,sessionContext:()=>({info,state:{},tracker:{}}),ownerOf:()=> 'admin',owners:()=>[{workerId:'worker1',cwd:path.join(floorDir,'agents','video-editor')}],prompt:()=>{},write:()=>{}}};
 const ctx={cfg:{dataDir:path.join(floorDir,'.agent-office'),trustProxy:false},floors:new Map([['floor1',floor]]),accounts:{get:(id:string|undefined)=>people.find(a=>a.id===id)},meOf:(id:string|undefined)=>({admin:!id||id==='admin'})};
 const office={caller:'admin' as string|undefined,repo:realpathSync(repo),floorDir,outside};
 const server=http.createServer((req,res)=>{const url=new URL(req.url!,'http://localhost');const route=url.pathname.startsWith('/api/shares')?sharesRoute:workerChatRoutes.chat;void (route.handle as Function)(ctx,{req,res,url,path:url.pathname,session:{account:office.caller?{id:office.caller}:undefined}}).catch(()=>{res.statusCode=500;res.end();});});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const snapshot=async()=>(await (await fetch(`${base}/api/worker-chat?floor=floor1&worker=worker1`)).json()) as ChatSnapshot;
 const file=(rel:string,root?:string,range?:string)=>fetch(`${base}/api/worker-chat/file?floor=floor1&worker=worker1${root?`&root=${root}`:''}&path=${encodeURIComponent(rel)}`,{headers:range?{Range:range}:{}});
 const share=(dir:string,origin=base)=>fetch(`${base}/api/shares?floor=floor1`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({dir})});
 return {...office,office,snapshot,file,share};
}
const RENDER='youtube/s/edit/v01/renders/x-v01.mp4';
test('a file linked outside the floor opens once an admin shares its folder, and only what the worker linked there',async t=>{
 const o=await linkOffice(t,`Done: [Watch the edit](<REPO/outputs/${RENDER}>) · [Cover](<REPO/outputs/top.png:12>) and \`outputs/rel.png\`, [up](../../outputs/up.png).`);
 const outputs=path.join(o.repo,'outputs'),renders=path.dirname(path.join(outputs,RENDER));
 mkdirSync(path.join(outputs,'segments'),{recursive:true});mkdirSync(path.join(renders,'segments'),{recursive:true});mkdirSync(path.join(outputs,'config'));
 // Far past the bounded scan: a link is looked up, never found by walking.
 mkdirSync(path.join(outputs,'decoys'));for(let i=0;i<3001;i++)writeFileSync(path.join(outputs,'decoys',`d${i}.png`),'');
 writeFileSync(path.join(outputs,RENDER),Buffer.alloc(4096,1));writeFileSync(path.join(renders,'x-v00.mp4'),'v0');writeFileSync(path.join(renders,'segments','001.mp4'),'s');writeFileSync(path.join(renders,'.hidden.png'),'');
 writeFileSync(path.join(outputs,'top.png'),'top');writeFileSync(path.join(outputs,'other.png'),'other');writeFileSync(path.join(outputs,'config','settings.json'),'{}');
 const elsewhere=path.join(o.outside,'elsewhere');mkdirSync(elsewhere);writeFileSync(path.join(elsewhere,'a.png'),'');symlinkSync(elsewhere,path.join(renders,'away'));symlinkSync(path.join(outputs,'config'),path.join(renders,'config'));
 mkdirSync(path.join(o.floorDir,'outputs'));writeFileSync(path.join(o.floorDir,'outputs','rel.png'),'r');writeFileSync(path.join(o.floorDir,'outputs','up.png'),'u');
 mkdirSync(path.join(o.floorDir,'agents','video-editor'),{recursive:true});writeFileSync(path.join(o.floorDir,'agents','video-editor','mcp.local.json'),'{"mcpServers":{}}');
 // Relative links: from the specialist's own folder, then from the floor.
 let data=await o.snapshot();assert.deepEqual(data.linked.map(f=>[f.root,f.path]),[[undefined,'outputs/rel.png'],[undefined,'outputs/up.png']]);
 assert.deepEqual(data.outside?.map(l=>l.folder),[outputs,outputs]);assert.equal(data.outside?.[0].link,`${path.join(o.outside,'Content OS','outputs',RENDER)}`);assert.deepEqual(data.shares,[]);
 o.office.caller='peer';data=await o.snapshot();assert.equal(data.outside,undefined);assert.equal(data.shares,undefined);
 assert.equal((await o.share(outputs)).status,403);o.office.caller='admin';assert.equal((await o.share(outputs,'https://attacker.test')).status,403);
 const shared=await (await o.share(outputs)).json();assert.match(shared.share.id,/^s[0-9a-f]{10}$/);
 data=await o.snapshot();const root=shared.share.id;
 assert.deepEqual(data.linked[0],{...data.linked[0],root,path:RENDER,type:'video/mp4',size:4096,link:path.join(o.outside,'Content OS','outputs',RENDER)});
 assert.deepEqual(data.linked.map(f=>f.path),[RENDER,'top.png','outputs/rel.png','outputs/up.png']);assert.deepEqual(data.outside,[]);assert.deepEqual(data.shares?.map(s=>s.id),[root]);
 const ranged=await o.file(RENDER,root,'bytes=0-1023');assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-range'),'bytes 0-1023/4096');assert.equal((await ranged.arrayBuffer()).byteLength,1024);
 // A render opened in a tab of its own may load itself as media, and nothing else; a picture keeps the stricter policy.
 assert.equal(ranged.headers.get('content-security-policy'),"default-src 'none'; media-src 'self'; sandbox");assert.equal(ranged.headers.get('x-content-type-options'),'nosniff');
 assert.equal((await o.file('top.png',root)).headers.get('content-security-policy'),"default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
 for(const rel of ['youtube/s/edit/v01/renders/x-v00.mp4','youtube/s/edit/v01/renders/segments/001.mp4','top.png'])assert.equal((await o.file(rel,root)).status,200,rel);
 for(const rel of ['config/settings.json','other.png','decoys/d1.png','../x.png','.env','youtube/s/edit/v01/renders/.hidden.png','youtube/s/edit/v01/renders/away/a.png','youtube/s/edit/v01/renders/config/settings.json'])assert.equal((await o.file(rel,root)).status,404,rel);
 assert.equal((await o.file(RENDER,'s0000000000')).status,404);assert.equal((await o.file(RENDER)).status,404);
 assert.equal((await o.file('agents/video-editor/mcp.local.json')).status,404);assert.equal((await o.file('outputs/rel.png')).status,200);
 // A member who isn't the worker's owner keeps the floor's own files, never the share's.
 o.office.caller='peer';assert.equal((await o.file(RENDER,root)).status,403);
 data=await o.snapshot();assert.deepEqual(data.linked.map(f=>f.path),['outputs/rel.png','outputs/up.png']);assert.equal(data.shares,undefined);
});
test('video and audio stream past the preview cap by Range, and other types stay under it',async t=>{
 const o=await linkOffice(t,'Rendered.');mkdirSync(path.join(o.floorDir,'outputs'));
 const big=Math.floor(1.1*1024*1024*1024);writeFileSync(path.join(o.floorDir,'outputs','big.mp4'),'');truncateSync(path.join(o.floorDir,'outputs','big.mp4'),big);
 writeFileSync(path.join(o.floorDir,'outputs','big.txt'),'');truncateSync(path.join(o.floorDir,'outputs','big.txt'),big);
 const video=await o.file('outputs/big.mp4',undefined,'bytes=0-15');assert.equal(video.status,206);assert.equal(video.headers.get('content-range'),`bytes 0-15/${big}`);await video.arrayBuffer();
 assert.equal((await o.file('outputs/big.txt',undefined,'bytes=0-15')).status,413);
});
