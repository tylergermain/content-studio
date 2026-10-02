import './picker.css';
import { h } from '../dom';
import { store } from '../../state';
import type { SpecialistProfile } from '../../../shared/specialists';

export function specialistPicker(changed: (selected: boolean)=>void) {
  const select=h('select',{'aria-label':'Specialist'}) as HTMLSelectElement;
  select.append(h('option',{value:''},'General worker'));
  const note=h('p.setting-note',{},'Choose a role with its own instructions and folder, or hire a general worker.');
  const error=h('p.setting-note.bad',{role:'alert'});
  const name=h('input',{'aria-label':'Specialist name',placeholder:'Video Editor'}) as HTMLInputElement;
  const id=h('input',{'aria-label':'Specialist ID',placeholder:'video-editor'}) as HTMLInputElement;
  const instructions=h('textarea',{rows:7,'aria-label':'Specialist instructions',placeholder:'Describe its responsibilities and workflow…'}) as HTMLTextAreaElement;
  const save=h('button.btn',{type:'button'},'Save specialist');
  const fresh=h('button.btn',{type:'button'},'New specialist');
  const editor=h('details',{},h('summary',{},'Manage specialists'),h('div.specialist-editor',{},h('label',{},'Name',name),h('label',{},'Folder ID',id),h('label',{},'AGENTS.md instructions',instructions),h('p.setting-note',{},'MCP tools: add mcp.local.json inside this specialist’s folder on the Studio. Pi requires an MCP adapter. Profiles share the floor and are not computer sandboxes.'),h('div.specialist-buttons',{},fresh,save)));
  let list:SpecialistProfile[]=[];
  const url=`/api/specialists?${new URLSearchParams({floor:store.floor??''})}`;
  const update=()=>{
    const p=list.find(p=>p.id===select.value);
    note.textContent=p?`agents/${p.id}/ · ${p.tools.length?p.tools.join(', '):'No additional MCP servers'} · Shared floor access`:'General worker using the floor’s instructions.';
    if(p){id.value=p.id;name.value=p.name;instructions.value=p.instructions;id.readOnly=true;}
    changed(!!p);
  };
  const render=(selected='')=>{
    select.replaceChildren(h('option',{value:''},'General worker'),...list.map(p=>h('option',{value:p.id},p.name)));
    select.value=selected;update();
  };
  select.addEventListener('change',update);
  fresh.addEventListener('click',()=>{select.value='';update();id.readOnly=false;id.value='';name.value='';instructions.value='';name.focus();editor.open=true;});
  save.addEventListener('click',async()=>{
    save.disabled=true;error.textContent='';
    try {
      const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id.value,name:name.value,instructions:instructions.value})});
      const data=await r.json();if(!r.ok)throw new Error(data.error??'Could not save specialist');
      list=list.filter(p=>p.id!==data.profile.id);list.push(data.profile);render(data.profile.id);editor.open=false;
    }catch(e){error.textContent=e instanceof Error?e.message:'Could not save specialist';}finally{save.disabled=false;}
  });
  void fetch(url,{credentials:'same-origin',cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error??'Could not load specialists');list=data.profiles;render();}).catch(()=>{error.textContent='Specialists could not be loaded. General workers are still available.';});
  return {element:h('section.specialist-picker',{},h('label',{},'Specialist',select),note,store.me.admin?editor:null,error),value:()=>select.value||undefined};
}
