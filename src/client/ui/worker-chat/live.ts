import type { ChatSnapshot } from '../../../shared/worker-chat';
import { chatRequest } from './api';

interface LiveEvent { type: string; delta?: string; delegation?: { id: string; target: string }; error?: { message?: string }; session?: { id?: string } }
export class WorkerLive {
  private connection?: RTCPeerConnection;
  private events?: RTCDataChannel;
  private media?: MediaStream;
  private audio = new Audio();
  private ready = false;
  private disposed = false;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private voices: {role:string;text:string}[] = [];
  private delegated = new Set<string>();
  private pending?: {id:string;after:Set<string>};
  private snapshot?: ChatSnapshot;
  private contextStamp = '';
  constructor(private worker: string, private status: (text:string)=>void, private transcript: (role:string,text:string)=>void) { this.audio.autoplay=true; }
  get active() { return !!this.connection; }
  async start(snapshot:ChatSnapshot) {
    if(this.connection)return;
    this.disposed=false;this.voices=[];this.delegated.clear();this.pending=undefined;this.contextStamp='';this.snapshot=snapshot;this.status('Connecting to GPT-Live 1…');
    try {
      this.media=await navigator.mediaDevices.getUserMedia({audio:true});
      if(this.disposed){this.media.getTracks().forEach(t=>t.stop());return;}
      const pc=this.connection=new RTCPeerConnection();
      pc.ontrack=e=>{this.audio.srcObject=e.streams[0];void this.audio.play().catch(()=>this.status('Click Listen to enable voice playback'));};
      for(const track of this.media.getTracks())pc.addTrack(track,this.media);
      const channel=this.events=pc.createDataChannel('oai-events');
      channel.addEventListener('message',e=>{try{void this.receive(JSON.parse(e.data));}catch{this.status('An unreadable voice event was received');}});
      channel.addEventListener('close',()=>{if(!this.disposed){this.status('Live voice disconnected');this.cleanup();}});
      pc.addEventListener('connectionstatechange',()=>{if(pc.connectionState==='failed'){this.status('Voice connection failed. Try again.');this.cleanup();}});
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);
      if(pc.iceGatheringState!=='complete')await new Promise<void>((resolve,reject)=>{
        const done=()=>{if(pc.iceGatheringState!=='complete')return;clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',done);resolve();};
        const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',done);reject(new Error('Voice connection timed out'));},10000);pc.addEventListener('icegatheringstatechange',done);done();
      });
      if(this.disposed)return;
      const result=await chatRequest<{session:{id:string};transport:{sdp:string}}>(this.worker,'/live',{sdp:pc.localDescription?.sdp});
      if(this.disposed)return;
      if(!result.transport?.sdp)throw new Error('GPT-Live returned no connection answer');
      await pc.setRemoteDescription({type:'answer',sdp:result.transport.sdp});
    }catch(error){if(!this.disposed)this.status(error instanceof Error?error.message:'Live voice could not start');this.cleanup();}
  }
  private send(type:string,content:string,delegation_id:string|null=null){
    if(this.ready&&this.events?.readyState==='open')this.events.send(JSON.stringify({type,event_id:crypto.randomUUID(),delegation_id,content:Array.from(content).slice(0,120).join('')}));
  }
  private context(text:string,id:string|null=null){
    // At most 100 Unicode characters per append, beneath Live's 500-token event limit.
    const chars=Array.from(text);for(let i=0;i<chars.length;i+=100)this.send('session.thinking.append',chars.slice(i,i+100).join(''),id);
  }
  update(snapshot:ChatSnapshot){
    this.snapshot=snapshot;if(this.disposed||!this.ready)return;
    const latest=snapshot.messages.filter(m=>m.role==='assistant').slice(-1)[0];
    const stamp=`${snapshot.worker.status}:${latest?.id}:${snapshot.worker.activity}`;
    if(stamp!==this.contextStamp){this.contextStamp=stamp;this.context(`Verified worker status: ${snapshot.worker.status}. Activity: ${snapshot.worker.activity??'No recent activity'}. Latest reply: ${latest?.text.slice(-1500)??'No reply yet'}. Preview files: ${snapshot.artifacts.slice(0,6).map(a=>a.path).join(', ')}`);}
    if(this.pending&&latest&&!this.pending.after.has(latest.id)){
      this.context(`Worker response: ${latest.text.slice(-3500)}`,this.pending.id);
      this.send('session.commentary.append',`The worker has returned a response. Current status is ${snapshot.worker.status}. Explain the response from the verified context. Preview files: ${snapshot.artifacts.slice(0,3).map(a=>a.name).join(', ')||'none yet'}.`,this.pending.id);
      this.pending=undefined;
    }
  }
  private async receive(event:LiveEvent){
    if(event.type==='session.started'){
      if(this.disposed){this.events?.send(JSON.stringify({type:'session.close'}));return;}
      this.ready=true;this.status('Live with GPT-Live 1');
      if(this.snapshot){this.context(`This worker's recent conversation:\n${this.snapshot.messages.slice(-6).map(m=>`${m.role}: ${m.text.slice(-700)}`).join('\n')}`);this.update(this.snapshot);}return;
    }
    if(event.type==='session.closed'){this.cleanup();this.status('Live voice ended');return;}
    if(event.type==='error'){this.status(event.error?.message??'GPT-Live reported an error');return;}
    if(['session.input_transcript.delta','session.output_transcript.delta'].includes(event.type)&&event.delta){
      const role=event.type==='session.input_transcript.delta'?'You':'Live voice';
      const last=this.voices[this.voices.length-1];if(last?.role===role)last.text=(last.text+event.delta).slice(-12000);else this.voices.push({role,text:event.delta});
      this.voices=this.voices.slice(-20);this.transcript(role,this.voices[this.voices.length-1].text);return;
    }
    if(event.type==='session.delegation.created'&&event.delegation?.target==='client'){
      const id=event.delegation.id;if(this.delegated.has(id))return;this.delegated.add(id);
      await new Promise(resolve=>setTimeout(resolve,350));if(this.disposed)return;
      const latest=this.voices.filter(v=>v.role==='You').slice(-1)[0]?.text.trim().slice(-5000);
      if(!latest){this.send('session.commentary.append','I could not get a clear transcript. Please repeat the instruction.',id);return;}
      try{
        if(/^(please )?(stop|pause|cancel|interrupt)( the| this)?( task| work| agent| worker)?[.!]?$/i.test(latest)){
          await chatRequest(this.worker,'/interrupt',{});this.send('session.commentary.append','An interrupt was sent to the worker. Check its next status update to confirm it stopped.',id);return;
        }
        const context=this.voices.slice(-8).map(v=>`${v.role}: ${v.text}`).join('\n').slice(-12000);
        const baseline=new Set(this.snapshot?.messages.filter(m=>m.role==='assistant').map(m=>m.id));
        await chatRequest(this.worker,'/message',{text:`Follow this live voice request in your current session. Transcripts can contain mistakes; ask if the intent is unclear.\n\nRecent voice conversation:\n${context}\n\nLatest user request: ${latest}\n\nRespond with the result or progress so the voice assistant can report back.`,requestId:id});
        this.pending={id,after:baseline};this.send('session.commentary.append','The request was sent to the current worker session. Work is pending; no result has been confirmed yet.',id);
      }catch(error){this.send('session.commentary.append',error instanceof Error?error.message:'The request could not be sent.',id);}
    }
  }
  listen(){void this.audio.play();}
  mute(muted:boolean){this.media?.getAudioTracks().forEach(t=>t.enabled=!muted);}
  stop(){
    this.disposed=true;this.media?.getTracks().forEach(t=>t.stop());this.audio.pause();
    if(this.ready&&this.events?.readyState==='open'){this.events.send(JSON.stringify({type:'session.close'}));this.status('Ending live voice…');this.closeTimer=setTimeout(()=>this.cleanup(),15000);}else this.cleanup();
  }
  private cleanup(){
    clearTimeout(this.closeTimer);this.ready=false;this.media?.getTracks().forEach(t=>t.stop());this.media=undefined;
    this.events?.close();this.events=undefined;const pc=this.connection;this.connection=undefined;pc?.close();this.audio.pause();this.audio.srcObject=null;
  }
}
