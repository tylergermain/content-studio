import './ui.css';
import { h, openModal, STATUS_LABEL, type Modal } from '../../ui/dom';
import { markdownFile } from '../../ui/markdown';
import { store } from '../../state';
import { engineLabel } from '../../ui/provider';
import type { ChatArtifact, ChatSnapshot } from '../../../shared/worker-chat';
import { chatRequest, chatUrl } from './api';
import { WorkerLive } from './live';

let current: {id:string;modal:Modal}|undefined;
export function openWorkerChat(id:string,terminal:()=>void,onChanges?:()=>void){
  if(current?.id===id)return;current?.modal.close();const worker=store.workers.get(id);if(!worker)return;
  const workerName=worker.name;const floor=store.floor;let closed=false,busy=false,polling=false,snapshot:ChatSnapshot|undefined,stamp='',fileStamp='',selected:ChatArtifact|undefined,muted=false;
  const status=h('span.chat-status',{},STATUS_LABEL[worker.status]??worker.status);
  const messages=h('div.chat-messages',{'aria-live':'polite'});
  const input=h('textarea',{'aria-label':'Message this worker',placeholder:'Ask a question or give the worker a direction…',maxlength:20000}) as HTMLTextAreaElement;
  const note=h('p.chat-note',{},'Your messages go to this worker’s current session.');
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
  const artifactList=h('div.artifact-list',{'aria-label':'Worker output files'});
  const stage=h('div.preview-stage');const caption=h('div.preview-caption',{},'Choose a file to preview it here.');
  const live=new WorkerLive(id,text=>{voiceStatus.textContent=text;talk.textContent=live.active?'End live voice':'Talk live';mute.classList.toggle('hidden',!live.active);listen.classList.toggle('hidden',!live.active);},(role,text)=>{transcript.classList.remove('hidden');transcript.textContent=`${role}: ${text}`;});
  const raw=h('button.btn.small',{type:'button'},'Terminal');
  const changes=onChanges?h('button.btn.small',{type:'button'},'Changes'):null;
  const form=h('form.chat-compose',{},input,h('div.chat-actions',{},send,interrupt,talk,mute,listen),note,voiceStatus);
  const paneNav=h('div.chat-pane-nav',{'aria-label':'Worker chat views'});
  const updates=h('button.btn',{type:'button','aria-pressed':'true'},'Updates');
  const previews=h('button.btn',{type:'button','aria-pressed':'false'},'Content preview');
  paneNav.append(updates,previews);
  const el=h('div.modal.worker-chat',{role:'dialog','aria-label':`${worker.name} chat`,'data-pane':'updates'},h('header',{},h('div',{},h('h2',{},worker.name),h('p.chat-subtitle',{},engineLabel(worker,store.project))),status,changes,raw),paneNav,h('div.chat-grid',{},h('section.chat-conversation',{},messages,transcript,setup,form),h('aside.chat-preview',{},h('h3.preview-heading',{},'Content preview'),artifactList,stage,caption)));
  const choosePane=(pane:string)=>{el.dataset.pane=pane;updates.setAttribute('aria-pressed',String(pane==='updates'));previews.setAttribute('aria-pressed',String(pane==='preview'));};
  updates.addEventListener('click',()=>choosePane('updates'));previews.addEventListener('click',()=>choosePane('preview'));
  const modal=openModal(el,{doing:`chatting with ${worker.name}`,onClose:()=>{closed=true;clearInterval(timer);abort.abort();live.stop();off();if(current?.id===id)current=undefined;}});current={id,modal};
  const abort=new AbortController();const off=store.on('floor',()=>{if(store.floor!==floor)modal.close();});
  raw.addEventListener('click',()=>{modal.close();terminal();});changes?.addEventListener('click',()=>{modal.close();onChanges?.();});
  function failure(error:unknown){note.textContent=error instanceof Error?error.message:'The worker could not be reached';note.classList.add('error');}
  function localImages(body:HTMLElement,base='') {
    for(const img of body.querySelectorAll('img')) {
      try {const url=new URL(img.getAttribute('src')??'',`http://workspace.invalid/${base}`);if(url.protocol!=='http:'||url.hostname!=='workspace.invalid'){img.remove();continue;}img.src=chatUrl(id,'/file',decodeURIComponent(url.pathname.slice(1)));}catch{img.remove();}
    }
  }
  async function preview(file:ChatArtifact){
    selected=file;caption.textContent=file.path;for(const b of artifactList.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.path===file.path));
    const url=chatUrl(id,'/file',file.path);stage.replaceChildren();
    if(file.type.startsWith('image/')){stage.append(h('img',{src:url,alt:file.name}));return;}
    if(file.type.startsWith('video/')){stage.append(h('video',{src:url,controls:true,preload:'metadata'}));return;}
    if(file.type.startsWith('audio/')){stage.append(h('audio',{src:url,controls:true,preload:'metadata'}));return;}
    if(file.type==='text/html'||file.type==='application/pdf'){stage.append(h('iframe',{src:url,title:file.name,sandbox:''}));return;}
    if(file.size>2*1024*1024){stage.append(h('p.chat-empty',{},'This text file is too large for an inline preview.'));return;}
    try{const response=await fetch(url,{signal:abort.signal});if(!response.ok)throw new Error('This file is no longer available');const text=await response.text();if(closed||selected?.path!==file.path)return;const body=file.name.endsWith('.md')?markdownFile(text):h('pre',{},text);localImages(body,file.path.slice(0,file.path.lastIndexOf('/')+1));stage.append(body);}catch(error){if(!closed)stage.append(h('p.chat-empty',{},error instanceof Error?error.message:'Preview unavailable'));}
  }
  function paint(data:ChatSnapshot){
    snapshot=data;status.textContent=STATUS_LABEL[data.worker.status as keyof typeof STATUS_LABEL]??data.worker.status;
    const next=JSON.stringify(data.messages);if(next!==stamp){stamp=next;const nearBottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<100;messages.replaceChildren();
      if(!data.messages.length)messages.append(h('div.chat-empty',{},'Start a conversation with this worker. Its replies will appear here as the session updates.'));
      for(const m of data.messages){const body=markdownFile(m.text);localImages(body);
        messages.append(h(`article.chat-message.${m.role}`,{},h('span.chat-message-label',{},m.role==='user'?'YOU':workerName.toUpperCase()),body));}
      if(nearBottom||messages.scrollTop===0)messages.scrollTop=messages.scrollHeight;
    }
    const nextFiles=JSON.stringify(data.artifacts);if(nextFiles!==fileStamp){fileStamp=nextFiles;artifactList.replaceChildren();
      if(!data.artifacts.length){artifactList.append(h('span.chat-note',{},'No preview files yet'));if(!selected)stage.replaceChildren(h('p.chat-empty',{},'Images, videos, scripts, and page previews from this worker’s workspace will appear here.'));}
      for(const file of data.artifacts){const b=h('button.artifact',{type:'button','data-path':file.path,'aria-pressed':String(selected?.path===file.path),title:file.path},file.type.startsWith('image/')?h('img',{src:chatUrl(id,'/file',file.path),alt:'',loading:'lazy'}):h('span',{},file.type.startsWith('video/')?'▶':file.type==='text/html'?'↗':'▤'),h('span',{},file.name));b.addEventListener('click',()=>void preview(file));artifactList.append(b);}
      if(selected){const fresh=data.artifacts.find(f=>f.path===selected!.path);if(fresh&&fresh.modified!==selected.modified)void preview(fresh);}
      else if(data.artifacts.length)void preview(data.artifacts.find(f=>f.type.startsWith('image/'))??data.artifacts[0]);
    }
    live.update(data);
  }
  async function refresh(){if(polling||closed)return;polling=true;try{const data=await chatRequest<ChatSnapshot>(id);if(!closed)paint(data);}catch(error){if(!closed)failure(error);}finally{polling=false;}}
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
  const timer=setInterval(()=>void refresh(),2000);void refresh();input.focus();
}
