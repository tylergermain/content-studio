import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,statSync,symlinkSync,rmSync,mkdirSync } from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {profiles,prepareSpecialist,roleWorkspace,saveProfile,specialistFolder} from '../src/server/specialists/profiles.js';
import {specialistLaunch} from '../src/server/specialists/launch.js';
import {artifactPath,listArtifacts,publicArtifact} from '../src/server/worker-chat/artifacts.js';
import type {WorkerInfo} from '../src/shared/protocol.js';
function fixture(t:{after(fn:()=>void):void}){const dir=mkdtempSync(path.join(tmpdir(),'specialists-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
test('starter roles are lazy, editable and persisted without exposing tool credentials',t=>{
 const dir=fixture(t);assert.equal(profiles(dir).length,3);
 const p=prepareSpecialist(dir,'video-editor','codex');const folder=specialistFolder(dir,p.id);
 assert.match(readFileSync(path.join(folder,'AGENTS.md'),'utf8'),/non-destructively/);
 assert.equal(statSync(path.join(folder,'mcp.local.json')).mode&0o777,0o600);
 assert.match(readFileSync(path.join(dir,'.gitignore'),'utf8'),/mcp.local.json/);
 writeFileSync(path.join(folder,'mcp.local.json'),JSON.stringify({mcpServers:{editing:{command:'node',env:{TOKEN:'secret'}}}}));
 const changed=saveProfile(dir,{id:p.id,name:'My Editor',instructions:'Use the shared footage.'});
 assert.deepEqual(changed.tools,['editing']);assert.equal(profiles(dir).find(p=>p.id==='video-editor')?.name,'My Editor');
 assert.ok(!JSON.stringify(profiles(dir)).includes('secret'));
 assert.throws(()=>prepareSpecialist(dir,p.id,'pi'),/adapter/);
});
test('specialist paths and instruction files reject traversal and symlinks',t=>{
 const dir=fixture(t);assert.throws(()=>specialistFolder(dir,'../outside'),/Invalid/);
 const outside=fixture(t);symlinkSync(outside,path.join(dir,'agents'));
 assert.throws(()=>saveProfile(dir,{id:'editor',name:'Editor',instructions:'Edit.'}),/ordinary/);
});
test('existing role instructions survive first hire',t=>{
 const dir=fixture(t),folder=specialistFolder(dir,'designer');mkdirSync(folder,{recursive:true});
 writeFileSync(path.join(folder,'AGENTS.md'),'Existing brand rules');
 prepareSpecialist(dir,'designer','claude');assert.equal(profiles(dir).find(p=>p.id==='designer')?.instructions,'Existing brand rules\n');
});
test('Claude merges native tool configs and Codex passes secrets through environment, preserving launch hooks',t=>{
 const dir=fixture(t);prepareSpecialist(dir,'researcher','codex');
 writeFileSync(path.join(specialistFolder(dir,'researcher'),'mcp.local.json'),JSON.stringify({mcpServers:{research:{command:'node',args:['tools.js'],env:{RESEARCH_TOKEN:'private-token'}}}}));
 const info={specialist:'researcher',provider:'codex'} as WorkerInfo;
 const plan=specialistLaunch({args:['--dangerously-bypass-approvals-and-sandbox'],env:{HOOK:'yes'},rotateToken:true},info,dir);
 assert.equal(plan.env?.RESEARCH_TOKEN,'private-token');assert.equal(plan.env?.HOOK,'yes');assert.equal(plan.rotateToken,true);
 assert.ok(!plan.args.join(' ').includes('private-token'));assert.ok(plan.args.includes('mcp_servers.research.command="node"'));
 const claude=specialistLaunch({args:['--mcp-config','office.json','--settings','hooks.json','--','Task']},{...info,provider:'claude'},dir);
 assert.equal(claude.args.filter(a=>a==='--mcp-config').length,1);assert.ok(claude.args.includes('office.json'));assert.equal(claude.args.at(-1),'Task');
 assert.throws(()=>specialistLaunch({args:[]},{...info,provider:'pi'},dir),/adapter/);
});
test('HTTP MCP servers resolve credentials from the worker environment without stdio-only options',t=>{
 const dir=fixture(t);prepareSpecialist(dir,'researcher','codex');
 writeFileSync(path.join(specialistFolder(dir,'researcher'),'mcp.local.json'),JSON.stringify({mcpServers:{web:{url:'http://127.0.0.1:9/mcp',env:{WEB_TOKEN:'private-token'},bearer_token_env_var:'WEB_TOKEN',env_http_headers:{'X-Token':'WEB_TOKEN'}}}}));
 const plan=specialistLaunch({args:[]},{specialist:'researcher',provider:'codex'} as WorkerInfo,dir);
 assert.equal(plan.env?.WEB_TOKEN,'private-token');assert.ok(!plan.args.some(a=>a.includes('env_vars')));
 assert.ok(plan.args.includes('mcp_servers.web.env_http_headers."X-Token"="WEB_TOKEN"'));
 assert.ok(!plan.args.join(' ').includes('private-token'));
});

test('shared content previews cannot list or open private specialist tool configurations',async t=>{
 const dir=fixture(t);prepareSpecialist(dir,'researcher','codex');
 const file='agents/researcher/mcp.local.json';
 writeFileSync(path.join(dir,file),JSON.stringify({mcpServers:{research:{command:'node',env:{TOKEN:'private-token'}}}}));
 assert.equal(publicArtifact(file),false);assert.equal(await artifactPath(dir,file),undefined);
 assert.ok(!(await listArtifacts(dir)).some(a=>a.path===file));
});

test('a role keeps the interface an admin picks, and older profiles open with their starter one',t=>{
 const dir=fixture(t);
 const saved=saveProfile(dir,{id:'thumbnails',name:'Thumbnails',instructions:'Make thumbnails.',workspace:'board'});
 assert.equal(saved.workspace,'board');
 assert.deepEqual(JSON.parse(readFileSync(path.join(specialistFolder(dir,'thumbnails'),'profile.json'),'utf8')),{id:'thumbnails',name:'Thumbnails',workspace:'board'});
 assert.equal(profiles(dir).find(p=>p.id==='thumbnails')?.workspace,'board');
 assert.equal(roleWorkspace(dir,'thumbnails'),'board');
 // A save that names no interface keeps the one the role has; a new pick shows at once.
 saveProfile(dir,{id:'thumbnails',name:'Thumbnails',instructions:'Make better thumbnails.'});
 assert.equal(profiles(dir).find(p=>p.id==='thumbnails')?.workspace,'board');
 saveProfile(dir,{id:'thumbnails',name:'Thumbnails',instructions:'Make thumbnails.',workspace:'reader'});
 assert.equal(roleWorkspace(dir,'thumbnails'),'reader');
 assert.throws(()=>saveProfile(dir,{id:'thumbnails',name:'Thumbnails',instructions:'Make thumbnails.',workspace:'theater'}),/Choose an interface/);
 assert.throws(()=>saveProfile(dir,{id:'thumbnails',name:'Thumbnails',instructions:'Make thumbnails.',workspace:['board']}),/Choose an interface/);
 assert.equal(profiles(dir).find(p=>p.id==='thumbnails')?.workspace,'reader');
 // The Content floor's Video Editor was saved as {id, name} before interfaces came in.
 const editor=specialistFolder(dir,'video-editor');mkdirSync(editor,{recursive:true});
 writeFileSync(path.join(editor,'profile.json'),JSON.stringify({id:'video-editor',name:'Video Editor'}));writeFileSync(path.join(editor,'AGENTS.md'),'Edit.');
 assert.equal(profiles(dir).find(p=>p.id==='video-editor')?.workspace,'screening');
 assert.equal(roleWorkspace(dir,'video-editor'),'screening');
 // A custom role with no interface, or one hand-edited to something that isn't one, opens with Files.
 const custom=specialistFolder(dir,'podcast');mkdirSync(custom,{recursive:true});
 writeFileSync(path.join(custom,'profile.json'),JSON.stringify({id:'podcast',name:'Podcast',workspace:'stage'}));writeFileSync(path.join(custom,'AGENTS.md'),'Produce.');
 assert.equal(profiles(dir).find(p=>p.id==='podcast')?.workspace,'files');
 assert.equal(roleWorkspace(dir,'podcast'),'files');
 assert.equal(roleWorkspace(dir,undefined),'files');
 // Every starter carries its interface, and is told to link what it makes and keep each version.
 for(const p of profiles(fixture(t))) {assert.ok(p.workspace,p.id);assert.match(p.instructions,/Markdown link to its full path/);assert.match(p.instructions,/new file \(name-v02/);}
 assert.equal(prepareSpecialist(fixture(t),'designer','codex').workspace,'board');
});

test('the chat never fails over a broken role folder',t=>{
 const dir=fixture(t);
 assert.equal(roleWorkspace(dir,'../outside'),'files');
 assert.equal(roleWorkspace(path.join(dir,'missing'),'video-editor'),'screening');
 const broken=specialistFolder(dir,'designer');mkdirSync(broken,{recursive:true});writeFileSync(path.join(broken,'profile.json'),'{not json');
 assert.equal(roleWorkspace(dir,'designer'),'board');
 const folder=specialistFolder(dir,'reels');mkdirSync(path.join(folder,'profile.json'),{recursive:true});
 assert.equal(roleWorkspace(dir,'reels'),'files');
 const elsewhere=fixture(t);writeFileSync(path.join(elsewhere,'profile.json'),JSON.stringify({workspace:'board'}));
 const linked=specialistFolder(dir,'linked');mkdirSync(linked,{recursive:true});symlinkSync(path.join(elsewhere,'profile.json'),path.join(linked,'profile.json'));
 assert.equal(roleWorkspace(dir,'linked'),'files');
 const symlinked=fixture(t),outside=fixture(t);symlinkSync(outside,path.join(symlinked,'agents'));
 assert.equal(roleWorkspace(symlinked,'video-editor'),'screening');
 const file=fixture(t);writeFileSync(path.join(file,'agents'),'not a folder');
 assert.equal(roleWorkspace(file,'researcher'),'reader');
});
