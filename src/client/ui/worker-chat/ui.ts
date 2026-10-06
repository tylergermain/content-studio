import './ui.css';
import { h, openModal, STATUS_LABEL, type Modal } from '../../ui/dom';
import { markdownFile } from '../../ui/markdown';
import { store } from '../../state';
import { engineLabel } from '../../ui/provider';
import { artifactKey, type ChatSnapshot, type LinkedFile } from '../../../shared/worker-chat';
import { WORKSPACES, isWorkspaceKind, workspaceOf, type WorkspaceKind } from '../../../shared/workspace';
import { mountWorkspace } from '../workspace';
import type { WorkspaceHost } from '../workspace/types';
import { chatRequest, chatUrl, reviewRequest, shareRequest } from './api';
import { localImages, wireLinks } from './links';
import { WorkerLive } from './live';

let current: {id:string;modal:Modal}|undefined;
export function openWorkerChat(id:string,terminal:()=>void,onChanges?:()=>void){
  if(current?.id===id)return;current?.modal.close();const worker=store.workers.get(id);if(!worker)return;
  const workerName=worker.name;const floor=store.floor;let closed=false,busy=false,polling=false,again=false,snapshot:ChatSnapshot|undefined,stamp='',muted=false;
  const status=h('span.chat-status',{},STATUS_LABEL[worker.status]??worker.status);
  const messages=h('div.chat-messages',{'aria-live':'polite'});
  const input=h('textarea',{'aria-label':'Message this worker',placeholder:'Ask a question or give the worker a direction…',maxlength:20000}) as HTMLTextAreaElement;
  const note=h('p.chat-note',{},'Your messages go to this worker’s current session.');
  const readOnly=h('p.chat-note.chat-read-only',{},`You can follow ${workerName} here, but only an admin or the person who hired it can send it messages, notes or approvals.`);
  const send=h('button.btn.primary',{type:'submit'},'Send message') as HTMLButtonElement;
  const interrupt=h('button.btn',{type:'button'},'Interrupt work');
  const talk=h('button.btn',{type:'button'},'Talk live') as HTMLButtonElement;
  const mute=h('button.btn.hidden',{type:'button'},'Mute mic');
  const listen=h('button.btn.hidden',{type:'button'},'Listen');
  const voiceStatus=h('p.chat-note',{},'GPT-Live 1 is optional. It uses OpenAI API billing while connected.');
  const transcript=h('div.voice-transcript.hidden');
  const setup=h('div.live-setup.hidden');
  const setupKey=h('input',{type:'password','aria-label':'OpenAI project API key',placeholder:'OpenAI project API key',autocomplete:'off'}) as HTMLInputElement;
  const saveKey=h('button.btn',{type:'button'},'Save API key');
  const cancelSetup=h('button.btn',{type:'button'},'Cancel');
  setup.append(h('strong',{},'Live voice setup'),h('p.chat-note',{},'The key is stored privately on your Mac Studio and is never sent back to the browser.'),setupKey,h('div.chat-actions',{},saveKey,cancelSetup));
  const live=new WorkerLive(id,text=>{voiceStatus.textContent=text;talk.textContent=live.active?'End live voice':'Talk live';mute.classList.toggle('hidden',!live.active);listen.classList.toggle('hidden',!live.active);},(role,text)=>{transcript.classList.remove('hidden');transcript.textContent=`${role}: ${text}`;});
  const raw=h('button.btn.small',{type:'button'},'Terminal');
  const changes=onChanges?h('button.btn.small',{type:'button'},'Changes'):null;
  const form=h('form.chat-compose',{},input,h('div.chat-actions',{},send,interrupt,talk,mute,listen),note,voiceStatus,readOnly);
  // The right-hand side is the worker's workspace (ui/workspace): its role's interface, a Screening room for the Video
  // Editor, or Files. The snapshot names the role's choice; until it comes, the starter roles' own.
  const fileUrl=(f:{root?:string;path:string})=>chatUrl(id,'/file',f.path,f.root);
  const host:WorkspaceHost={workerId:id,workerName,get admin(){return store.me.admin;},canSend:()=>!!snapshot&&snapshot.canSend!==false,url:fileUrl,
    review:async r=>{await reviewRequest(id,{...r,requestId:crypto.randomUUID()});if(!closed)await refresh();},refresh:()=>refresh(),draft:t=>{input.value=t;input.focus();input.setSelectionRange(t.length,t.length);}};
  let kind:WorkspaceKind=workspaceOf(worker.specialist);let workspace=mountWorkspace(host,kind);
  const aside=h('aside.chat-preview',{},workspace.element);
  const paneNav=h('div.chat-pane-nav',{'aria-label':'Worker chat views'});
  const updates=h('button.btn',{type:'button','aria-pressed':'true'},'Updates');
  const previews=h('button.btn',{type:'button','aria-pressed':'false'},WORKSPACES[kind].label);
  paneNav.append(updates,previews);
  const el=h('div.modal.worker-chat',{role:'dialog','aria-label':`${worker.name} chat`,'data-pane':'updates','data-layout':kind},h('header',{},h('div',{},h('h2',{},worker.name),h('p.chat-subtitle',{},engineLabel(worker,store.project))),status,changes,raw),paneNav,h('div.chat-grid',{},h('section.chat-conversation',{},messages,transcript,setup,form),aside));
  const choosePane=(pane:string)=>{el.dataset.pane=pane;updates.setAttribute('aria-pressed',String(pane==='updates'));previews.setAttribute('aria-pressed',String(pane==='preview'));};
  updates.addEventListener('click',()=>choosePane('updates'));previews.addEventListener('click',()=>choosePane('preview'));
  const modal=openModal(el,{doing:`chatting with ${worker.name}`,onClose:()=>{closed=true;clearInterval(timer);live.stop();workspace.stop();off();if(current?.id===id)current=undefined;}});current={id,modal};
  const off=store.on('floor',()=>{if(store.floor!==floor)modal.close();});
  raw.addEventListener('click',()=>{modal.close();terminal();});changes?.addEventListener('click',()=>{modal.close();onChanges?.();});
  function failure(error:unknown){note.textContent=error instanceof Error?error.message:'The worker could not be reached';note.classList.add('error');}
  // For wireLinks: a linked file opens in the workspace (its pane on a narrow window), and an admin can share its folder.
  const links={url:fileUrl,open:(f:LinkedFile)=>{choosePane('preview');workspace.show(artifactKey(f));},share:async(folder:string)=>{await shareRequest(folder);await refresh();if(!closed&&!el.contains(document.activeElement))workspace.element.focus({preventScroll:true});}};
  /** An admin gave the role another interface: the workspace is made again as that kind. */
  function remount(next:WorkspaceKind){workspace.stop();kind=next;workspace=mountWorkspace(host,kind);aside.replaceChildren(workspace.element);el.dataset.layout=kind;previews.textContent=WORKSPACES[kind].label;}
  function paint(data:ChatSnapshot){
    snapshot=data;status.textContent=STATUS_LABEL[data.worker.status as keyof typeof STATUS_LABEL]??data.worker.status;
    const linked=data.linked??[];
    // Links change with the messages, and when an admin shares the folder they point into.
    const next=JSON.stringify([data.messages,linked.map(f=>[f.link,f.root,f.path]),data.outside,data.liveAdmin]);if(next!==stamp){stamp=next;const nearBottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<100;messages.replaceChildren();
      if(!data.messages.length)messages.append(h('div.chat-empty',{},'Start a conversation with this worker. Its replies will appear here as the session updates.'));
      for(const m of data.messages){const body=markdownFile(m.text);localImages(body,linked,fileUrl);wireLinks(body,data,links);
        messages.append(h(`article.chat-message.${m.role}`,{},h('span.chat-message-label',{},m.role==='user'?'YOU':workerName.toUpperCase()),body));}
      if(nearBottom||messages.scrollTop===0)messages.scrollTop=messages.scrollHeight;
    }
    if(isWorkspaceKind(data.workspace)&&data.workspace!==kind)remount(data.workspace);
    workspace.paint(data);
    // A viewer who may watch but not direct this worker (snapshot.canSend) sees why instead of the controls.
    form.classList.toggle('read-only',data.canSend===false);
    live.update(data);
  }
  async function refresh(){if(closed)return;if(polling){again=true;return;}polling=true;try{const data=await chatRequest<ChatSnapshot>(id);if(!closed)paint(data);}catch(error){if(!closed)failure(error);}finally{polling=false;if(again&&!closed){again=false;void refresh();}}}
  form.addEventListener('submit',e=>{e.preventDefault();void submit();});
  async function submit(){if(busy||!input.value.trim())return;busy=true;send.disabled=true;note.classList.remove('error');const text=input.value;
    try{await chatRequest(id,'/message',{text,requestId:crypto.randomUUID()});if(closed)return;input.value='';note.textContent='Sent to the current worker session.';await refresh();}catch(error){failure(error);}finally{busy=false;send.disabled=false;}}
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();void submit();}});
  interrupt.addEventListener('click',()=>{void chatRequest(id,'/interrupt',{}).then(()=>{note.textContent='Interrupt sent. The next status update will confirm whether work stopped.';}).catch(failure);});
  talk.addEventListener('click',()=>{if(live.active){live.stop();talk.disabled=true;setTimeout(()=>{if(!closed){talk.disabled=false;talk.textContent='Talk live';mute.classList.add('hidden');listen.classList.add('hidden');}},15000);return;}
    if(!snapshot)return;if(!snapshot.liveConfigured){if(snapshot.liveAdmin){setup.classList.remove('hidden');setupKey.focus();}else voiceStatus.textContent='An admin needs to add an OpenAI API key in Live voice setup.';return;}void live.start(snapshot);});
  mute.addEventListener('click',()=>{muted=!muted;live.mute(muted);mute.textContent=muted?'Unmute mic':'Mute mic';});listen.addEventListener('click',()=>live.listen());
  cancelSetup.addEventListener('click',()=>{setupKey.value='';setup.classList.add('hidden');});
  saveKey.addEventListener('click',()=>{void chatRequest(id,'/key',{key:setupKey.value}).then(()=>{setupKey.value='';setup.classList.add('hidden');if(snapshot)snapshot.liveConfigured=true;voiceStatus.textContent='Live voice is configured. Click Talk live to connect.';void refresh();}).catch(error=>{voiceStatus.textContent=error instanceof Error?error.message:'Could not save the key';});});
  const timer=setInterval(()=>void refresh(),2000);void refresh();
  // Focus waits a frame, so the E that opened the window isn't typed into it. A workspace of its own takes the keys
  // (Space plays a render); a plain chat starts in the text box.
  requestAnimationFrame(()=>{if(closed)return;if(kind==='files')input.focus();else workspace.element.focus({preventScroll:true});});
}
