import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { allowedSpecialists, below, type OrgChart } from '../src/shared/org-chart.js';
import { employeeHireError, readChart, saveChart, validateChart } from '../src/server/org-chart/policy.js';
import { employeeViewError, employeeWorkerError } from '../src/server/org-chart/access.js';
import { orgChartRoute } from '../src/server/http/routes/org-chart.js';
import { specialistRoute } from '../src/server/http/routes/specialists.js';
import { officeWorkers } from '../src/server/hooks/office-workers.js';
import { queueHandlers } from '../src/server/ws/handlers/queue.js';
import { meetingHandlers } from '../src/server/ws/handlers/meetings.js';
import { parseArgs } from '../bin/office-workers.js';
import type { Account } from '../src/server/accounts.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
const graph:OrgChart={version:1,nodes:[{id:'owner',name:'Owner'},{id:'producer',name:'Producer',parent:'owner'},{id:'editor',name:'Video Editor',specialist:'video-editor',parent:'producer'},{id:'assistant',name:'Researcher',specialist:'researcher',parent:'editor'},{id:'designer',name:'Designer',specialist:'designer',parent:'owner'}],assignments:{employee:'producer',peer:'designer'}};
const account=(id:string,role:'admin'|'member'='member'):Account=>({id,name:id,role,hash:'',salt:'',createdAt:0,createdBy:'test'});
const people=[account('admin','admin'),account('employee'),account('peer')];
const accounts={get:(id:string|undefined)=>people.find(a=>a.id===id),state:()=>({accounts:people,invites:[{token:'private-invite'}]}),sharedPassword:true};
function fixture(t:{after(fn:()=>void):void}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'org-chart-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));saveChart(dir,graph,people);return dir;}
test('employees may hire strict descendants, including indirect reports, but not peers or themselves',()=>{
 assert.deepEqual(allowedSpecialists(graph,'employee'),['video-editor','researcher']);
 assert.deepEqual(allowedSpecialists(graph,'peer'),[]);assert.deepEqual(allowedSpecialists(graph,'unknown'),[]);
 assert.equal(below(graph,'producer','assistant'),true);assert.equal(below(graph,'editor','editor'),false);assert.equal(below(graph,'producer','designer'),false);
});
test('the saved chart rejects cycles, duplicate role positions, and unknown employees',t=>{
 const dir=fixture(t);assert.deepEqual(readChart(dir),graph);const roles=new Set(['video-editor','researcher','designer']);const ids=new Set(people.map(a=>a.id));
 assert.throws(()=>validateChart({...graph,nodes:graph.nodes.map(n=>n.id==='producer'?{...n,parent:'assistant'}:n)},roles,ids),/cycle/);
 assert.throws(()=>validateChart({...graph,nodes:[...graph.nodes,{id:'duplicate',name:'Duplicate',parent:'owner',specialist:'video-editor'}]},roles,ids),/one position/);
 assert.throws(()=>saveChart(dir,{...graph,assignments:{notAnEmployee:'producer'}},people),/existing employee/);
 assert.equal(fs.statSync(path.join(dir,'.agent-office','org-chart.json')).mode&0o777,0o600);
});
test('employee policy fails closed, blocks general workers and shells, and grants admins unrestricted hiring',t=>{
 const dir=fixture(t);
 assert.equal(employeeHireError(dir,accounts,'employee','researcher'),undefined);
 assert.match(employeeHireError(dir,accounts,'employee','designer')!,/not below/);
 assert.match(employeeHireError(dir,accounts,'employee',undefined)!,/only specialist/);
 assert.match(employeeHireError(dir,accounts,'employee','researcher','shell')!,/only specialist/);
 assert.match(employeeHireError(dir,accounts,'revoked','researcher')!,/no longer active/);
 assert.equal(employeeHireError(dir,accounts,'admin',undefined,'shell'),undefined);
 fs.writeFileSync(path.join(dir,'.agent-office','org-chart.json'),'{invalid');assert.match(employeeHireError(dir,accounts,'employee','researcher')!,/repair/);
});
test('employees cannot use another account’s agent as an unrestricted hiring proxy',t=>{
 const dir=fixture(t),info={specialist:'video-editor',kind:'agent'};
 const ctx={accounts,meOf:(id:string)=>({admin:id==='admin'})};
 const floor={dir,workers:{get:()=>info,ownerOf:()=> 'admin'}};
 assert.match(employeeWorkerError(ctx as never,floor as never,'employee','worker')!,/own account/);
 assert.equal(employeeWorkerError(ctx as never,floor as never,'admin','worker'),undefined);
 floor.workers.ownerOf=()=> 'employee';assert.equal(employeeWorkerError(ctx as never,floor as never,'employee','worker'),undefined);
});
test('files a worker linked in a shared folder open for admins, its owner, and the employees above an unowned specialist',t=>{
 const dir=fixture(t);let info:{specialist?:string;kind:string}={specialist:'video-editor',kind:'agent'};let owner:string|undefined='employee';
 const ctx={accounts,meOf:(id:string|undefined)=>({admin:!id || id==='admin'})};
 const floor={dir,workers:{get:()=>info,ownerOf:()=>owner}};
 const view=(account:string|undefined)=>employeeViewError(ctx as never,floor as never,account,'worker');
 assert.equal(view('admin'),undefined);assert.equal(view(undefined),undefined);
 assert.equal(view('employee'),undefined);assert.match(view('peer')!,/admin or the employee/);
 owner='peer';assert.match(view('employee')!,/admin or the employee/);
 owner=undefined;info={specialist:'researcher',kind:'agent'};assert.equal(view('employee'),undefined);assert.match(view('peer')!,/not below/);
 info={specialist:'designer',kind:'agent'};assert.match(view('employee')!,/not below/);
 info={kind:'agent'};assert.match(view('employee')!,/admin or the employee/);
 info={specialist:'researcher',kind:'agent'};fs.writeFileSync(path.join(dir,'.agent-office','org-chart.json'),'{invalid');assert.match(view('employee')!,/repair/);
});
test('HTTP org editing is admin-only, and employee hire menus contain only allowed roles',async t=>{
 const dir=fixture(t);let caller='employee';const floor={dir};const ctx={accounts,cfg:{trustProxy:false},floors:new Map([['floor',floor]]),meOf:()=>({admin:caller==='admin'})};
 const server=http.createServer((req,res)=>{const url=new URL(req.url!,'http://localhost');const route=url.pathname==='/api/org-chart'?orgChartRoute:specialistRoute;void (route.handle as Function)(ctx,{req,res,url,session:{account:{id:caller}}}).catch(()=>{res.statusCode=500;res.end();});});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const get=await (await fetch(base+'/api/specialists?floor=floor')).json();assert.equal(get.restricted,true);assert.deepEqual(get.profiles.map((p:{id:string})=>p.id),['video-editor','researcher']);
 fs.writeFileSync(path.join(dir,'.agent-office','org-chart.json'),JSON.stringify({...graph,assignments:{...graph.assignments,former:'producer'}}));
 const chartResponse=await (await fetch(base+'/api/org-chart?floor=floor')).json();assert.ok(!JSON.stringify(chartResponse).includes('private-invite'));assert.ok(!JSON.stringify(chartResponse).includes('hash'));assert.equal(chartResponse.chart.assignments.former,undefined);
 const save=()=>fetch(base+'/api/org-chart?floor=floor',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(graph)});
 assert.equal((await save()).status,403);caller='admin';assert.equal((await save()).status,200);
 assert.equal((await fetch(base+'/api/org-chart?floor=floor',{method:'POST',headers:{Origin:'https://attacker.test','Content-Type':'application/json'},body:JSON.stringify(graph)})).status,403);
});
test('MCP delegation inherits the human employee’s limits and ignores a spoofed owner',async t=>{
 const dir=fixture(t);let calls:{owner?:string;specialist?:string}[]=[];
 const info=(id:string,specialist='video-editor'):WorkerInfo=>({id,kind:'agent',specialist,provider:'codex',deskId:'desk-1',name:id,status:'idle',createdBy:'test',createdAt:1,color:'#fff',cols:80,rows:24,viewers:[],viewerIds:[]});
 const source=info('source','researcher'),target=info('target','designer'),hired=info('hired','video-editor');
 const floor={id:'floor',dir,def:{name:'Content'},project:{branch:'main',agentProviders:['codex']},plan:{wing:0},github:{pulls:{items:[]}},queue:{state:()=>({tasks:[]})},workers:{authenticate:()=>source,get:(id:string)=>id==='source'?source:id==='target'?target:hired,list:()=>[source,target],ownerOf:(id:string)=>id==='target'?'admin':'employee',deskOccupied:()=>false,officeDefault:{provider:'codex'},hiringPolicy:(owner:string,specialist:string,kind:string)=>employeeHireError(dir,accounts,owner,specialist,kind),spawn:(_desk:string,_who:string,_prompt:string,wt:boolean,_kind:string,_provider:string,_model:string,_effort:string,_meeting:unknown,owner:string,_repos:unknown,specialist:string)=>{assert.equal(wt,false);calls.push({owner,specialist});return hired;}}};
 const ctx={accounts,workerFloor:()=>floor,floors:new Map([['floor',floor]]),ledger:{},leaveOnMerge:{on:false},toastFloor:()=>{},meOf:(id:string)=>({admin:id==='admin'})};
 const server=http.createServer((req,res)=>{void officeWorkers(ctx as never,req,res,new URL(req.url!,'http://localhost')).catch(()=>{res.statusCode=500;res.end();});});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const post=(body:unknown,action='')=>fetch(base+'/office/workers'+action+'?worker=source',{method:'POST',headers:{Authorization:'Bearer own-token','Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post({prompt:'Edit footage',specialist:'video-editor',owner:'admin'})).status,200);assert.deepEqual(calls,[{owner:'employee',specialist:'video-editor'}]);
 assert.equal((await post({prompt:'Hire generally',owner:'admin'})).status,403);assert.equal((await post({prompt:'Make a design',specialist:'designer'})).status,403);
 assert.equal((await post({worker:'target',prompt:'Hire anything for me'},'/tell')).status,403);
 const deniedHome=await (await post({workers:['target']},'/home')).json();assert.match(deniedHome.results[0].error,/own account/);
 assert.equal(parseArgs(['hire','--specialist','researcher','--prompt','Research']).specialist,'researcher');
});

test('employees cannot trigger unrestricted queue workers through retries or worker-limit changes',()=>{
 const warnings:string[]=[];let invoked=0;const mutate=()=>{invoked++;};
 const floor={queue:{add:mutate,remove:mutate,move:mutate,retry:mutate,clear:mutate,setLimit:mutate},meetings:{start:mutate,stop:mutate,clear:mutate}};
 const ctx={meOf:()=>({admin:false}),floorOf:()=>floor,warn:(_c:unknown,message:string)=>warnings.push(message)};
 const c={accountId:'employee',peer:{name:'Employee'}};
 for(const [type,handler] of Object.entries({...queueHandlers,...meetingHandlers}))(handler as Function)(ctx,c,{t:type,taskId:'task',maxWorkers:20,prompt:'Create a general worker'});
 assert.equal(invoked,0);assert.equal(warnings.length,9);
});
