import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { parseConversation } from '../src/server/worker-chat/transcripts.js';
import { artifactPath, listArtifacts, publicArtifact } from '../src/server/worker-chat/artifacts.js';
import { createLiveSession, saveLiveKey } from '../src/server/worker-chat/live.js';
import { mergeMessages } from '../src/server/worker-chat/history.js';
import { workerChatRoutes } from '../src/server/http/routes/worker-chat.js';
import { displayChatText } from '../src/shared/worker-chat.js';
import type { ChatSnapshot } from '../src/shared/worker-chat.js';

const fixture:ChatSnapshot={worker:{id:'worker1',name:'Creator',provider:'codex',status:'working'},messages:[],artifacts:[],source:'waiting',liveConfigured:false,liveAdmin:true};
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
 admin=false;assert.equal((await post('/key',{key:'sk-testing-key-12345678'})).status,403);assert.equal((await post('/live',{sdp:'v=0'})).status,503);
});
