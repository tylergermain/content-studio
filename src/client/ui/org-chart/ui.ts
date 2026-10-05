import './ui.css';
import { h, openModal } from '../dom';
import { store } from '../../state';
import { below, type OrgChart, type OrgNode, type OrgAccount } from '../../../shared/org-chart';

type View={chart:OrgChart;accounts:OrgAccount[];profiles:{id:string;name:string}[];admin:boolean;sharedPassword:boolean;allowed?:string[]};
export function openOrgChart() {
  const content=h('div.body.org-content',{},h('p',{},'Loading the org chart…'));
  const error=h('p.setting-note.bad',{role:'alert'});
  const save=h('button.btn.primary',{type:'button',disabled:true},'Save changes') as HTMLButtonElement;
  const footer=h('footer',{},error,save);
  const modal=openModal(h('section.modal.org-chart',{role:'dialog','aria-label':'Org chart'},h('header',{},h('h2',{},'Org chart')),content,footer));
  const url=`/api/org-chart?${new URLSearchParams({floor:store.floor??''})}`;
  let view:View,chart:OrgChart,selected:string;
  const render=()=>{
    const nodes=new Map(chart.nodes.map(n=>[n.id,n]));
    const assigned=(id:string)=>view.accounts.filter(a=>chart.assignments[a.id]===id);
    const tree=h('div.org-tree',{'aria-label':'Reporting hierarchy'});
    const walk=(n:OrgNode,depth:number)=>{
      const people=assigned(n.id);
      const card=h('button.org-card',{type:'button','aria-pressed':String(n.id===selected),style:`--depth:${Math.min(depth,5)}`,onclick:()=>{selected=n.id;render();}},h('strong',{},n.name),h('span',{},n.specialist?'Specialist agent':'Team position'),h('small',{},people.length?people.map(p=>p.name).join(', '):n.specialist?'Available to employees above this role':'No employee assigned'));
      tree.append(card);for(const child of chart.nodes.filter(c=>c.parent===n.id))walk(child,depth+1);
    };
    chart.nodes.filter(n=>!n.parent).forEach(n=>walk(n,0));
    const panel=h('div.org-panel');
    const note=h('p.setting-note',{},view.admin?'Assign human employees to positions, then place the specialist roles they can hire below them. Employees can hire direct and indirect reports.':'You can hire only specialist roles below your assigned position. Ask an admin to change reporting relationships.');
    if(view.admin) {
      if(view.sharedPassword)panel.append(h('p.setting-note.org-warning',{},'Employee restrictions require individual member accounts. The shared office password grants admin access; manage it under Accounts.'));
      const current=nodes.get(selected);
      if(current) {
        const name=h('input',{type:'text','aria-label':'Position name',value:current.name,onchange:(e:Event)=>{current.name=(e.target as HTMLInputElement).value;render();}});
        const parent=h('select',{'aria-label':'Reports to'}) as HTMLSelectElement;
        if(!current.parent)parent.append(h('option',{value:''},'Top position'));
        else for(const n of chart.nodes.filter(n=>n.id!==current.id && !below(chart,current.id,n.id)))parent.append(h('option',{value:n.id},n.name));
        parent.value=current.parent??'';parent.disabled=!current.parent;parent.onchange=()=>{current.parent=parent.value||undefined;render();};
        const role=h('select',{'aria-label':'Specialist role'}) as HTMLSelectElement;
        role.append(h('option',{value:''},'Human team position'));
        for(const p of view.profiles.filter(p=>p.id===current.specialist || !chart.nodes.some(n=>n.specialist===p.id)))role.append(h('option',{value:p.id},p.name));
        role.value=current.specialist??'';role.onchange=()=>{current.specialist=role.value||undefined;render();};
        panel.append(h('h3',{},'Edit position'),h('label',{},'Position name',name),h('label',{},'Reports to',parent),h('label',{},'Type',role));
        const add=h('button.btn',{type:'button',onclick:()=>{const id=`position-${Math.random().toString(36).slice(2,10)}`;chart.nodes.push({id,name:'New position',parent:current.id});selected=id;render();}},'Add direct report');
        const remove=h('button.btn.danger',{type:'button',disabled:!current.parent,onclick:()=>{for(const n of chart.nodes)if(n.parent===current.id)n.parent=current.parent;chart.nodes=chart.nodes.filter(n=>n.id!==current.id);for(const [account,node] of Object.entries(chart.assignments))if(node===current.id)delete chart.assignments[account];selected=current.parent!;render();}},'Remove position');
        panel.append(h('div.org-buttons',{},add,remove));
      }
      panel.append(h('h3',{},'Human employees'));
      if(!view.accounts.length)panel.append(h('p.setting-note',{},'Create individual employee accounts under Accounts, then assign their positions here.'));
      for(const account of view.accounts) {
        const pick=h('select',{'aria-label':`Position for ${account.name}`}) as HTMLSelectElement;
        pick.append(h('option',{value:''},account.role==='admin'?'Admin, unrestricted':'Unassigned, cannot hire'));
        for(const n of chart.nodes)pick.append(h('option',{value:n.id},n.name));
        pick.value=chart.assignments[account.id]??'';pick.onchange=()=>{if(pick.value)chart.assignments[account.id]=pick.value;else delete chart.assignments[account.id];render();};
        panel.append(h('label',{},`${account.name}${account.role==='admin'?' (admin)':''}`,pick));
      }
    } else {
      panel.append(h('h3',{},'Your hiring access'));
      const allowed=view.profiles.filter(p=>view.allowed?.includes(p.id));
      panel.append(h('p',{},allowed.length?allowed.map(p=>p.name).join(', '):'No specialist roles are assigned beneath your position yet.'));
      for(const account of view.accounts) {const position=nodes.get(chart.assignments[account.id]);if(position)panel.append(h('p.setting-note',{},`${account.name}: ${position.name}`));}
    }
    content.replaceChildren(note,h('div.org-layout',{},tree,panel));save.disabled=!view.admin;save.hidden=!view.admin;
  };
  save.addEventListener('click',async()=>{
    save.disabled=true;error.textContent='';
    try {const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(chart)});const data=await r.json();if(!r.ok)throw new Error(data.error??'Could not save the chart');chart=data.chart;render();error.classList.remove('bad');error.textContent='Saved. Hiring rules apply immediately.';}
    catch(e){error.classList.add('bad');error.textContent=e instanceof Error?e.message:'Could not save the chart';save.disabled=false;}
  });
  void fetch(url,{credentials:'same-origin',cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error??'Could not load the chart');view=data;chart=data.chart;selected=chart.nodes[0].id;render();}).catch(e=>{content.replaceChildren(h('p',{},e instanceof Error?e.message:'Could not load the chart'));});
  return modal;
}
