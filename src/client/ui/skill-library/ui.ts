import './ui.css';
import { h, openModal, toast } from '../dom';
import { markdownFile } from '../markdown';
import { store } from '../../state';
import type { LibrarySkill, SkillDocument } from '../../../shared/skill-library';

export function openSkillLibrary() {
 const floor=store.floor;if(!floor)return;
 let skills:LibrarySkill[]=[],selected='',document:SkillDocument|undefined,admin=false,request=0,editing=false,busy=false;
 const search=h('input',{type:'search',placeholder:'Search skills…','aria-label':'Search skills'}) as HTMLInputElement;
 const category=h('select',{'aria-label':'Skill category'},h('option',{value:''},'All categories')) as HTMLSelectElement;
 const list=h('div.skill-library-list');
 const title=h('h3',{},'Choose a skill'),meta=h('p.skill-library-meta'),body=h('div.md.skill-library-content');
 const versions=h('select',{'aria-label':'Skill version'}) as HTMLSelectElement;
 const edit=h('button.btn',{type:'button'},'Edit instructions'),restore=h('button.btn',{type:'button'},'Restore this version');
 const compare=h('button.btn',{type:'button'},'Compare with current');
 const diff=h('pre.skill-library-diff',{});diff.hidden=true;
 const text=h('textarea',{'aria-label':'Skill instructions',spellcheck:'false'}) as HTMLTextAreaElement;text.hidden=true;
 const note=h('input',{placeholder:'What changed?','aria-label':'Version note',maxlength:200}) as HTMLInputElement;note.hidden=true;
 const save=h('button.btn.primary',{type:'button'},'Save new version'),cancel=h('button.btn',{type:'button'},'Cancel edit');save.hidden=cancel.hidden=true;
 const status=h('p.skill-library-meta',{'aria-live':'polite'},'Loading skills…');
 const el=h('div.modal.skill-library',{role:'dialog','aria-label':'AI Innovators skill library'},h('header',{},h('h2',{},'Skill library'),h('p',{},'AI Innovators · Private Git history')),h('div.skill-library-grid',{},h('aside',{},search,category,status,list),h('section.skill-library-detail',{},title,meta,h('div.skill-library-tools',{},versions,compare,edit,restore),body,diff,text,note,h('div.skill-library-tools',{},save,cancel))),h('footer',{},'Versioned instruction snapshots. Saving updates this library; installed skill packages remain separate.'));
 const modal=openModal(el,{doing:'browsing the skill library'});
 const off=store.on('floor',()=>{if(store.floor!==floor)modal.close();});
 const url=(id?:string,version?:string)=>`/api/skill-library?${new URLSearchParams({floor,...(id?{skill:id}:{}),...(version?{version}:{})})}`;
 async function api(u:string,options?:RequestInit){const r=await fetch(u,{credentials:'same-origin',cache:'no-store',...options});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load skills');return d;}
 function paintList(){
  const q=search.value.trim().toLowerCase();const found=skills.filter(s=>(!category.value||s.category===category.value)&&(!q||`${s.name} ${s.id} ${s.description}`.toLowerCase().includes(q)));
  status.textContent=`${found.length} of ${skills.length} skills`;
  list.replaceChildren(...found.map(s=>{const b=h('button.skill-library-item',{type:'button','aria-pressed':String(s.id===selected)},h('strong',{},s.name),h('span',{},s.description||s.category),h('small',{},`${s.category} · ${s.version||'Unversioned'}${s.dirty?' · Local changes':''}`));b.addEventListener('click',()=>{if(editing)return toast('Save or cancel your edit before switching skills','warn');void load(s.id);});return b;}));
 }
 function controls(){
  edit.hidden=!admin||editing||versions.value!=='';restore.hidden=!admin||editing||!versions.value;
  compare.hidden=editing||!document?.diff;save.hidden=cancel.hidden=note.hidden=text.hidden=!editing;body.hidden=editing;
  versions.disabled=busy||editing;edit.disabled=restore.disabled=save.disabled=busy;
 }
 function paint(d:SkillDocument,version=''){
  document=d;selected=d.skill.id;editing=false;title.textContent=d.skill.name;
  meta.textContent=`${d.skill.category} · ${version?`Version ${version.slice(0,7)}`:`Current ${d.skill.version}`} · ${d.skill.id}`;
  body.replaceChildren(markdownFile(d.text));
  versions.replaceChildren(h('option',{value:''},'Current instructions'),...d.versions.map(v=>h('option',{value:v.id},`${v.id.slice(0,7)} · ${new Date(v.date).toLocaleDateString()} · ${v.message}`)));
  versions.value=version;compare.textContent='Compare with current';diff.textContent=d.diff||'';diff.hidden=true;controls();paintList();
 }
 async function load(id:string,version=''){
  const token=++request;busy=true;controls();status.textContent='Loading version…';
  try{const d=await api(url(id,version));if(token===request&&el.isConnected)paint(d,version);}catch(e){if(token===request)status.textContent=e instanceof Error?e.message:'Could not load skill';}finally{if(token===request){busy=false;controls();}}
 }
 search.addEventListener('input',paintList);category.addEventListener('change',paintList);
 versions.addEventListener('change',()=>void load(selected,versions.value));
 compare.addEventListener('click',()=>{diff.hidden=!diff.hidden;compare.textContent=diff.hidden?'Compare with current':'Hide comparison';});
 edit.addEventListener('click',()=>{if(!document)return;editing=true;text.value=document.text;note.value='';diff.hidden=true;controls();text.focus();});
 cancel.addEventListener('click',()=>{editing=false;controls();});
 async function record(version?:string){
  if(!document||busy)return;
  const message=version?`Restore ${version.slice(0,7)}`:note.value.trim();if(!message)return toast('Describe what changed before saving','warn');
  busy=true;controls();
  try{const d=await api(url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:selected,text:text.value,expected:document.revision,message,restore:version})});skills=skills.map(s=>s.id===selected?d.skill:s);paint(d);toast(version?'Restored as a new version':'New skill version saved');}catch(e){toast(e instanceof Error?e.message:'Could not save the version','warn');}finally{busy=false;controls();}
 }
 save.addEventListener('click',()=>void record());
 restore.addEventListener('click',()=>{if(!versions.value)return;const yes=h('button.btn.primary',{type:'button'},'Restore as new version');const no=h('button.btn',{type:'button'},'Cancel');const confirmation=openModal(h('div.modal',{role:'alertdialog','aria-label':'Restore skill version'},h('header',{},h('h2',{},'Restore this version?')),h('div.body',{},'This makes the selected instructions current in a new commit. Existing versions stay in history.'),h('footer',{},no,yes)));no.addEventListener('click',()=>confirmation.close());yes.addEventListener('click',()=>{confirmation.close();void record(versions.value);});});
 void api(url()).then(d=>{if(!el.isConnected)return;skills=d.skills;admin=d.admin;category.append(...[...new Set(skills.map(s=>s.category))].sort().map(c=>h('option',{value:c},c)));paintList();if(skills.length)void load(skills[0].id);else body.textContent='No skills imported yet. Add SKILL.md files under this floor’s skill-library/skills folder and commit them to its Git repository.';controls();}).catch(e=>{status.textContent=e.message;});
 // Subscriptions end when the modal is detached, including X and Escape.
 const watch=new MutationObserver(()=>{if(!el.isConnected){off();watch.disconnect();}});watch.observe(el.parentElement!,{childList:true});controls();
}
