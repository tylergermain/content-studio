import './ui.css';
import { BUILD_AREA, ORIGINAL_DESKS, SNAP, layoutDesks, validateLayout, type DeskLayout } from '../../../shared/office-builder';
import { FLOOR, PLANTS, WING, WING_DESKS } from '../../../shared/layout';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';
import { openDeskLabel } from '../../ui/floorplan';

const NS='http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>={}) {
  const el=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el;
}
export function openOfficeBuilder(net:Net) {
  if(!store.me.admin || !store.floor || store.map.pick!=='office')return toast('Open an office floor as an admin to build','warn');
  const floor=store.floor;
  let draft:DeskLayout=structuredClone(store.floorPlan.desks??{});
  let revision=store.floorPlan.layoutRevision??0;
  let selected=ORIGINAL_DESKS[0].id;
  let dirty=false, pending=false, conflict=false;
  const status=h('p.builder-status',{'role':'status'},'Select a desk, then drag it on the plan or use the position controls.');
  const drawing=svg('svg',{viewBox:'-19 -23 38 37',role:'img','aria-label':'Office floor plan'});
  drawing.classList.add('builder-plan');
  const inspector=h('div.builder-inspector');
  const save=h('button.btn.primary',{type:'button'},'Save layout');
  const reset=h('button.btn',{type:'button'},'Restore original layout');
  const reload=h('button.btn',{type:'button'},'Reload saved layout');
  const wing=h('div.builder-expansion');
  const root=h('section.modal.office-builder',{},
    h('header',{},h('div',{},h('p.builder-eyebrow',{},'CONTENT STUDIO / SPACE PLANNING'),h('h2',{},'Build your office'))),
    h('div.builder-body',{},h('div.builder-workspace',{},h('div.builder-plan-heading',{},h('span',{},'Your floor plan'),h('span',{},'¼ m grid')),drawing,h('p.builder-caption',{},'The blue area is editable. Desks, chairs, and plants need their own space.')),h('aside',{},inspector,wing)),
    h('footer',{},status,h('div.builder-buttons',{},reload,reset,save)));
  const busy=(id:string)=>!!store.workerAtDesk(id);
  const error=()=>validateLayout(draft);
  function paint(){
    drawing.replaceChildren();
    const defs=svg('defs');const pattern=svg('pattern',{id:'builder-grid',width:1,height:1,patternUnits:'userSpaceOnUse'});pattern.append(svg('path',{d:'M 1 0 L 0 0 0 1',fill:'none',stroke:'#dce3e9','stroke-width':0.03}));defs.append(pattern);drawing.append(defs);
    drawing.append(svg('rect',{x:FLOOR.minX,y:FLOOR.minZ,width:36,height:26,rx:0.3,fill:'url(#builder-grid)',stroke:'#8da1af','stroke-width':0.15}));
    drawing.append(svg('rect',{x:BUILD_AREA.minX,y:BUILD_AREA.minZ,width:BUILD_AREA.maxX-BUILD_AREA.minX,height:BUILD_AREA.maxZ-BUILD_AREA.minZ,fill:'#e3f1fa',stroke:'#78aed0','stroke-width':0.08}));
    const text=(x:number,z:number,s:string)=>{const t=svg('text',{x,y:z,'font-size':0.55,fill:'#617682'});t.textContent=s;drawing.append(t);};
    text(9,-7,'Lounge');text(10.4,10,'Meeting room');text(-13,12,'Kitchen');text(3.4,-11.5,'Elevator');text(-13,-10.4,'Project boards');
    const level=store.floorPlan.wing;
    drawing.setAttribute('viewBox',`-19 ${-14-level*WING.row} 38 ${28+level*WING.row}`);
    if(level){drawing.append(svg('rect',{x:WING.minX,y:-13-level*WING.row,width:WING.maxX-WING.minX,height:level*WING.row,fill:'#e5eadb',stroke:'#8da17a','stroke-width':0.1}));text(13.7,-14,'Back office');}
    for(const d of WING_DESKS.filter(d=>(d.wing??0)<=level))drawing.append(svg('rect',{x:d.x-1.1,y:d.z-0.55,width:2.2,height:1.1,fill:'#9eb19c'}));
    for(const [x,z,s] of PLANTS)drawing.append(svg('circle',{cx:x,cy:z,r:0.3*s,fill:'#739579'}));
    for(const d of layoutDesks(draft)){
      const g=svg('g',{transform:`translate(${d.x} ${d.z}) rotate(${-d.rotY*180/Math.PI})`,tabindex:0,role:'button','aria-label':`${d.label}${busy(d.id)?', occupied':''}`,'data-desk':d.id});
      g.classList.add('builder-desk');if(d.id===selected)g.classList.add('selected');
      g.append(svg('rect',{x:-1.05,y:-0.5,width:2.1,height:1,rx:0.1,fill:busy(d.id)?'#adb9c1':d.id===selected?'#2c718f':'#7896a5'}),svg('rect',{x:-0.32,y:0.68,width:0.64,height:0.55,rx:0.15,fill:'#9caab3'}));
      const label=svg('text',{x:0,y:0.17,'text-anchor':'middle','font-size':0.4,fill:'white',transform:`rotate(${d.rotY*180/Math.PI})`});label.textContent=d.id.replace('desk-','');g.append(label);
      g.addEventListener('pointerdown',e=>startDrag(e,d.id));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selected=d.id;render();}});drawing.append(g);
    }
  }
  function setPose(x:number,z:number,rotY:number,redraw=true){
    if(busy(selected)||pending||conflict)return;
    if(![x,z,rotY].every(Number.isFinite)){status.textContent="Enter a valid position";save.disabled=true;return;}
    draft[selected]={x:Math.round(x/SNAP)*SNAP,z:Math.round(z/SNAP)*SNAP,rotY};dirty=true;if(redraw)render();else{paint();updateState();}
  }
  function render(){
    paint();inspector.replaceChildren();
    const d=layoutDesks(draft).find(d=>d.id===selected)!;
    inspector.append(h('p.builder-eyebrow',{},'SELECTED DESK'),h('h3',{},store.floorPlan.labels[d.id]?.text||d.label),h('p.builder-note',{},busy(d.id)?'This desk has a worker. Send it home before moving the desk.':'Position your workspace and leave room behind its chair.'));
    for(const [key,label] of [['x','Across (m)'],['z','Along (m)']] as const){
      const input=h('input',{type:'number',step:SNAP,'aria-label':label,disabled:busy(d.id)||pending||conflict});input.value=String(d[key]);input.addEventListener('change',()=>setPose(key==='x'?input.valueAsNumber:d.x,key==='z'?input.valueAsNumber:d.z,d.rotY,false));inspector.append(h('label.builder-field',{},label,input));
    }
    inspector.append(h('button.btn',{type:'button',disabled:busy(d.id)||pending||conflict,onclick:()=>setPose(d.x,d.z,(d.rotY+Math.PI/2)%(Math.PI*2))},'Rotate 90°'),h('button.btn',{type:'button',onclick:()=>openDeskLabel(net,d.id)},'Change desk sign'));
    wing.replaceChildren(h('p.builder-eyebrow',{},'ROOM TO GROW'),h('h3',{},'Back office'),h('p.builder-note',{},`${16+store.floorPlan.wing*2} desks available, with space for ${20-16-store.floorPlan.wing*2} more.`),h('p.builder-note',{},'Expansion changes apply immediately.'),h('button.btn',{type:'button',disabled:store.floorPlan.wing>=WING.rows||pending,onclick:()=>net.send({t:'floor.expand'})},'Expand by 2 desks'),h('button.btn',{type:'button',disabled:store.floorPlan.wing===0||pending,onclick:()=>net.send({t:'floor.shrink'})},'Remove last expansion'));
    updateState();
  }
  function updateState(){
    const problem=error();save.disabled=!dirty||pending||conflict||typeof problem==='string'||!net.up;
    reset.disabled=pending||conflict;
    if(conflict)status.textContent='Someone saved a newer layout. Reload it before saving your changes.';
    else if(pending)status.textContent='Saving your layout…';
    else if(typeof problem==='string')status.textContent=problem;
    else status.textContent=dirty?'Your changes are ready to save.':'Drag a desk to rearrange the floor. Changes apply when you save.';
    status.classList.toggle('invalid',conflict||typeof problem==='string');
  }
  let drag:{id:string,dx:number,dz:number,pointer:number}|null=null;
  function point(e:PointerEvent){const m=drawing.getScreenCTM();if(!m)return null;return new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());}
  function startDrag(e:PointerEvent,id:string){
    e.preventDefault();selected=id;const p=point(e);const d=layoutDesks(draft).find(d=>d.id===id)!;
    if(p&&!busy(id)&&!pending&&!conflict){drag={id,dx:d.x-p.x,dz:d.z-p.y,pointer:e.pointerId};drawing.setPointerCapture(e.pointerId);}render();
  }
  drawing.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.pointer)return;const p=point(e);if(p){const d=layoutDesks(draft).find(d=>d.id===drag!.id)!;setPose(p.x+drag.dx,p.y+drag.dz,d.rotY);}});
  const stopDrag=()=>{drag=null;};drawing.addEventListener('pointerup',stopDrag);drawing.addEventListener('pointercancel',stopDrag);
  reset.onclick=()=>{draft={};dirty=true;render();};
  reload.onclick=()=>{draft=structuredClone(store.floorPlan.desks??{});revision=store.floorPlan.layoutRevision??0;dirty=false;pending=false;conflict=false;render();};
  save.onclick=()=>{if(save.disabled)return;pending=true;net.send({t:'floor.layout',desks:draft,revision});render();};
  const off=store.on('floorPlan',()=>{
    const next=store.floorPlan.layoutRevision??0;
    if(next!==revision){
      if(pending && JSON.stringify(store.floorPlan.desks)===JSON.stringify(draft)){dirty=false;pending=false;revision=next;}
      else if(dirty){conflict=true;pending=false;}
      else{draft=structuredClone(store.floorPlan.desks??{});revision=next;}
    }
    render();
  });
  const workersOff=store.on('workers',render);
  const mapOff=store.on('map',()=>{if(store.map.pick!=='office')modal.close();});
  const messageOff=net.onMessage(m=>{if(m.t==='toast'&&pending&&m.level!=='info'){pending=false;render();status.textContent=m.text;}if(m.t==='floor.enter'&&store.floor!==floor)modal.close();});
  const statusOff=net.onStatus(up=>{if(!up){pending=false;status.textContent='Connection lost. Your draft is still here.';}render();});
  const modal=openModal(root,{doing:'designing the office',onClose:()=>{off();workersOff();mapOff();messageOff();statusOff();}});
  render();
}
