import { employeeWorkerError } from '../../org-chart/access.js';
import path from 'node:path';
import { displayChatText } from '../../../shared/worker-chat.js';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { conversation } from '../../worker-chat/transcripts.js';
import { artifactPath, artifactType, listArtifacts } from '../../worker-chat/artifacts.js';
import { chatHistory, keepMessage, mergeMessages } from '../../worker-chat/history.js';
import { createLiveSession, liveKey, saveLiveKey } from '../../worker-chat/live.js';
import { isAsleep } from '../../../shared/status.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';
import type { ChatArtifact, ChatSnapshot } from '../../../shared/worker-chat.js';
import type { Floor } from '../../floor.js';

const artifacts = new Map<string,{at:number;files:ChatArtifact[]}>();
const starts = new Map<string,number>();
async function snapshot(floor: Floor, id: string, dataDir: string, admin: boolean): Promise<ChatSnapshot | undefined> {
  const w = floor.workers.sessionContext(id); if (!w || w.info.kind !== 'agent') return;
  const cwd = w.info.specialist ? floor.dir : floor.workers.owners().find(o => o.workerId === id)?.cwd ?? floor.dir;
  const ownData = path.join(floor.dir,'.agent-office');
  const messages = await conversation(w,ownData);
  let files = artifacts.get(cwd);
  if (!files || Date.now()-files.at > 5000) { files={at:Date.now(),files:await listArtifacts(cwd)}; if(artifacts.size>128) artifacts.clear(); artifacts.set(cwd,files); }
  const {name,provider,status,activity,sessionId} = w.info;
  const merged = mergeMessages(messages,chatHistory(ownData,id));
  if (!merged.length && w.info.prompt) merged.push({id:'initial',role:'user',text:w.info.prompt,at:w.info.createdAt});
  return {worker:{id,name,provider,status,activity,sessionId},messages:merged,artifacts:files.files,source:messages.length?'session':'waiting',liveConfigured:!!liveKey(dataDir),liveAdmin:admin};
}

export const workerChatRoutes = {
  chat: {
    prefix:'/api/worker-chat',auth:'session',
    async handle(ctx,{req,res,url,path:p,session}) {
      const admin = ctx.meOf(session.account?.id).admin;
      if (req.method === 'POST' && !sameOrigin(req,ctx.cfg)) return send(res,403,{error:'Forbidden'});
      if (p === '/api/worker-chat/key') {
        if (req.method !== 'POST') return send(res,405,{error:'Method not allowed'});
        if (!admin) return send(res,403,{error:'Only an admin can configure Live voice'});
        let body; try { body=JSON.parse(await readBody(req,2048)); } catch { return send(res,400,{error:'Invalid key request'}); }
        return saveLiveKey(ctx.cfg.dataDir,body.key) ? send(res,200,{ok:true}) : send(res,400,{error:'Enter a valid OpenAI project API key'});
      }
      const floor = floorParam(ctx,url); const id = url.searchParams.get('worker') ?? '';
      if (!floor || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !floor.workers.get(id)) return send(res,404,{error:'No such worker'});
      if(req.method==='POST') { const denied=employeeWorkerError(ctx,floor,session.account?.id,id);if(denied)return send(res,403,{error:denied}); }
      if (p === '/api/worker-chat' && req.method === 'GET') {
        const data = await snapshot(floor,id,ctx.cfg.dataDir,admin);
        return data ? send(res,200,data) : send(res,400,{error:'Chat is available for agent workers'});
      }
      if (p === '/api/worker-chat/file' && req.method === 'GET') {
        const cwd = floor.workers.get(id)?.specialist ? floor.dir : floor.workers.owners().find(o => o.workerId===id)?.cwd ?? floor.dir;
        const file = url.searchParams.get('path') ?? ''; const resolved = await artifactPath(cwd,file);
        if (!resolved) return send(res,404,{error:'No preview is available for this file'});
        const fd = await open(resolved,constants.O_RDONLY | constants.O_NOFOLLOW);
        const s = await fd.stat(); if (!s.isFile() || s.size>1024*1024*1024) { await fd.close(); return send(res,413,{error:'File is too large to preview'}); }
        const type=artifactType(file); const range=req.headers.range;
        let start=0,end=Math.max(0,s.size-1),partial=false;
        if (range) {
          const match=/^bytes=(\d+)-(\d*)$/.exec(range);
          if (!match || Number(match[1])>=s.size) { await fd.close(); res.writeHead(416,{'content-range':`bytes */${s.size}`});res.end();return; }
          start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;partial=true;
          if(end<start){await fd.close();return send(res,416,{error:'Invalid range'});}
        }
        res.writeHead(partial?206:200,{'content-type':type,'content-length':String(s.size?end-start+1:0),'cache-control':'no-store','accept-ranges':'bytes',...(partial?{'content-range':`bytes ${start}-${end}/${s.size}`}:{ }),'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",'cross-origin-resource-policy':'same-origin'});
        if(!s.size){await fd.close();res.end();return;}
        const stream=fd.createReadStream({start,end,autoClose:true});res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);return;
      }
      if (req.method !== 'POST') return send(res,405,{error:'Method not allowed'});
      let body;try {body=JSON.parse(await readBody(req,70000));}catch{return send(res,400,{error:'Invalid request'});}
      if (p === '/api/worker-chat/live') {
        const key=liveKey(ctx.cfg.dataDir);if(!key)return send(res,503,{error:'Add an OpenAI API key in Live voice setup first'});
        if(typeof body.sdp!=='string'||body.sdp.length>64000||!body.sdp.startsWith('v=0'))return send(res,400,{error:'Invalid voice connection offer'});
        const data=await snapshot(floor,id,ctx.cfg.dataDir,admin);if(!data)return send(res,400,{error:'No agent session'});
        const who=session.account?.id??'shared';if(Date.now()-(starts.get(who)??0)<5000)return send(res,429,{error:'Wait a moment before starting another voice session'});
        if(starts.size>1000)starts.clear();starts.set(who,Date.now());
        try {const result=await createLiveSession(key,body.sdp,data);return send(res,result.status,result.body);}catch{return send(res,502,{error:'Could not connect to GPT-Live. Try again.'});}
      }
      if (p === '/api/worker-chat/interrupt') {floor.workers.write(id,'\x1b',session.account?.name??'Studio chat');return send(res,200,{ok:true});}
      if (p === '/api/worker-chat/message') {
        if(typeof body.text!=='string'||!body.text.trim()||body.text.length>20000||/[\x00-\x08\x0b-\x1f\x7f]/.test(body.text))return send(res,400,{error:'Enter a message of up to 20,000 characters'});
        if(typeof body.requestId!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(body.requestId))return send(res,400,{error:'Invalid message id'});
        const dir=path.join(floor.dir,'.agent-office');const saved=chatHistory(dir,id);
        if(saved.some(m=>m.id===body.requestId))return send(res,200,{ok:true,duplicate:true});
        const w=floor.workers.get(id)!;if(w.kind!=='agent')return send(res,400,{error:'Choose an agent worker'});
        const text=body.text.trim();const error=isAsleep(w.status)?floor.workers.resume(id,text):floor.workers.prompt(id,text,session.account?.name??'Studio chat');
        if(error)return send(res,409,{error});
        keepMessage(dir,id,{id:body.requestId,role:'user',text:displayChatText(text),at:Date.now()});return send(res,200,{ok:true});
      }
      return send(res,404,{error:'Not found'});
    },
  },
} satisfies Record<string,Route>;
