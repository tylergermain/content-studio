import { employeeViewError, employeeWorkerError } from '../../org-chart/access.js';
import path from 'node:path';
import { reviewText } from '../../../shared/workspace.js';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { conversation } from '../../worker-chat/transcripts.js';
import { artifactPath, artifactType, listArtifacts } from '../../worker-chat/artifacts.js';
import { chatHistory, mergeMessages } from '../../worker-chat/history.js';
import { createLiveSession, liveKey, saveLiveKey } from '../../worker-chat/live.js';
import { defaultRoot, outsideLinks, shareFile, workerLinks } from '../../worker-chat/links.js';
import { readShares, shareGuard } from '../../worker-chat/shares.js';
import { parseReview, reviewFiles } from '../../worker-chat/review.js';
import { sendable, sendToWorker } from '../../worker-chat/send.js';
import { roleWorkspace } from '../../specialists/profiles.js';
import { tildify } from '../../paths.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';
import type { ChatArtifact, ChatSnapshot } from '../../../shared/worker-chat.js';
import type { Floor } from '../../floor.js';
import type { Ctx } from '../../office/context.js';

const artifacts = new Map<string,{at:number;files:ChatArtifact[]}>();
const starts = new Map<string,number>();
async function snapshot(ctx: Ctx, floor: Floor, id: string, account: string | undefined): Promise<ChatSnapshot | undefined> {
  const w = floor.workers.sessionContext(id); if (!w || w.info.kind !== 'agent') return;
  const admin = ctx.meOf(account).admin; const cwd = defaultRoot(floor,id);
  const ownData = path.join(floor.dir,'.agent-office');
  const messages = await conversation(w,ownData);
  let files = artifacts.get(cwd);
  if (!files || Date.now()-files.at > 5000) { files={at:Date.now(),files:await listArtifacts(cwd)}; if(artifacts.size>128) artifacts.clear(); artifacts.set(cwd,files); }
  const {name,provider,status,activity,sessionId} = w.info;
  const merged = mergeMessages(messages,chatHistory(ownData,id));
  if (!merged.length && w.info.prompt) merged.push({id:'initial',role:'user',text:w.info.prompt,at:w.info.createdAt});
  // Files linked in a shared folder, and those beside them, go only to who may open them; what lies outside, and the shares, only to admins.
  const guard = shareGuard(ctx); const links = await workerLinks(floor,id,guard,messages);
  const viewer = admin || ![...links.linked,...links.nearby].some(f => f.root) || !employeeViewError(ctx,floor,account,id);
  const mine = <T extends ChatArtifact>(list: T[]) => viewer ? list : list.filter(f => !f.root);
  const adminOnly = admin ? {outside:await outsideLinks(links,floor,guard),shares:readShares(floor.dir,guard).map(s => ({id:s.id,label:tildify(s.dir)}))} : {};
  // Who may direct the worker (the POST gate below) may send it messages and reviews; anyone else gets a read-only window.
  const canSend = !employeeWorkerError(ctx,floor,account,id);
  return {worker:{id,name,provider,status,activity,sessionId},messages:merged,artifacts:files.files,linked:mine(links.linked),nearby:mine(links.nearby),...adminOnly,workspace:roleWorkspace(floor.dir,w.info.specialist),canSend,source:messages.length?'session':'waiting',liveConfigured:!!liveKey(ctx.cfg.dataDir),liveAdmin:admin};
}
const media = (type: string | undefined) => /^(video|audio)\//.test(type ?? '');
/** Video and audio stream by Range, so only the other types are held to the preview cap. */
const overCap = (size: number, type: string | undefined) => size>1024*1024*1024 && !media(type);
/**
 * Every file the office serves from a worker's folders is sandboxed, media included. Played in the office's own
 * window the policy doesn't apply; opened in a tab of its own (Cmd-click) a sandboxed render shows nothing, which is
 * the price of never letting a worker's file run as a page of the office.
 */
const policy = (type: string | undefined) => media(type) ? "default-src 'none'; media-src 'self'; sandbox" : "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";
/** 'a', 'a and b', or 'a, b and c'. */
const listed = (names: string[]) => names.length < 3 ? names.join(' and ') : `${names.slice(0,-1).join(', ')} and ${names.at(-1)}`;

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
        const data = await snapshot(ctx,floor,id,session.account?.id);
        return data ? send(res,200,data) : send(res,400,{error:'Chat is available for agent workers'});
      }
      if (p === '/api/worker-chat/file' && req.method === 'GET') {
        // Without a root, the worker's own folder; with one, a folder an admin shared, and only what the worker linked there.
        const file = url.searchParams.get('path') ?? ''; const root = url.searchParams.get('root') || undefined;
        if (root) { const denied=employeeViewError(ctx,floor,session.account?.id,id); if (denied) return send(res,403,{error:denied}); }
        const resolved = root ? await shareFile(floor,id,shareGuard(ctx),root,file) : await artifactPath(defaultRoot(floor,id),file);
        const fd = resolved && await open(resolved,constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined);
        if (!fd) return send(res,404,{error:'No preview is available for this file'});
        const type=artifactType(file); const s = await fd.stat(); if (!s.isFile() || overCap(s.size,type)) { await fd.close(); return send(res,413,{error:'File is too large to preview'}); }
        const range=req.headers.range;
        let start=0,end=Math.max(0,s.size-1),partial=false;
        if (range) {
          const match=/^bytes=(\d+)-(\d*)$/.exec(range);
          if (!match || Number(match[1])>=s.size) { await fd.close(); res.writeHead(416,{'content-range':`bytes */${s.size}`});res.end();return; }
          start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;partial=true;
          if(end<start){await fd.close();return send(res,416,{error:'Invalid range'});}
        }
        res.writeHead(partial?206:200,{'content-type':type,'content-length':String(s.size?end-start+1:0),'cache-control':'no-store','accept-ranges':'bytes',...(partial?{'content-range':`bytes ${start}-${end}/${s.size}`}:{ }),'x-content-type-options':'nosniff','content-security-policy':policy(type),'cross-origin-resource-policy':'same-origin'});
        if(!s.size){await fd.close();res.end();return;}
        const stream=fd.createReadStream({start,end,autoClose:true});res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);return;
      }
      if (req.method !== 'POST') return send(res,405,{error:'Method not allowed'});
      let body;try {body=JSON.parse(await readBody(req,70000));}catch{return send(res,400,{error:'Invalid request'});}
      const by=session.account?.name??'Studio chat';
      if (p === '/api/worker-chat/live') {
        const key=liveKey(ctx.cfg.dataDir);if(!key)return send(res,503,{error:'Add an OpenAI API key in Live voice setup first'});
        if(typeof body.sdp!=='string'||body.sdp.length>64000||!body.sdp.startsWith('v=0'))return send(res,400,{error:'Invalid voice connection offer'});
        const data=await snapshot(ctx,floor,id,session.account?.id);if(!data)return send(res,400,{error:'No agent session'});
        const who=session.account?.id??'shared';if(Date.now()-(starts.get(who)??0)<5000)return send(res,429,{error:'Wait a moment before starting another voice session'});
        if(starts.size>1000)starts.clear();starts.set(who,Date.now());
        try {const result=await createLiveSession(key,body.sdp,data);return send(res,result.status,result.body);}catch{return send(res,502,{error:'Could not connect to GPT-Live. Try again.'});}
      }
      if (p === '/api/worker-chat/interrupt') {floor.workers.write(id,'\x1b',by);return send(res,200,{ok:true});}
      if (p === '/api/worker-chat/message') {
        const sent=sendToWorker(floor,id,typeof body.text==='string'?body.text:'',typeof body.requestId==='string'?body.requestId:'',by);
        return send(res,sent.status,sent.body);
      }
      if (p === '/api/worker-chat/review') {
        // Notes, an approval, variations or a question about files this chat can open, written up here from their real paths.
        const review=parseReview(body);if('error' in review)return send(res,400,{error:review.error});
        const real=await reviewFiles(floor,id,shareGuard(ctx),review.files);if(!real)return send(res,404,{error:'That file is no longer available to open here'});
        const text=reviewText(review.kind,real,review.notes,review.text);
        if(!sendable(text))return send(res,400,{error:'These notes come to more than 20,000 characters. Send some of them first.'});
        const {kind,files,notes}=review;const sent=sendToWorker(floor,id,text,review.requestId,by,{kind,files,...(notes?{notes}:{})});
        if(kind==='approve'&&sent.status===200&&!sent.body.duplicate)ctx.toastFloor(floor,`${session.account?.name??'Someone'} approved ${listed(real.map(f => path.basename(f)))} from ${floor.workers.get(id)?.name??'a worker'}`);
        return send(res,sent.status,sent.body);
      }
      return send(res,404,{error:'Not found'});
    },
  },
} satisfies Record<string,Route>;
