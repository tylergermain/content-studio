import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { allowedSpecialists, type OrgAccount, type OrgChart } from '../../shared/org-chart.js';
import { profiles } from '../specialists/profiles.js';
import { specialistId } from '../../shared/specialists.js';
import type { Accounts } from '../accounts.js';

const nodeId=(id:unknown): id is string=>typeof id==='string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id);
export function defaultChart(root:string): OrgChart {
  return {version:1,nodes:[{id:'owner',name:'Studio Owner'},...profiles(root).map(p=>({id:`role-${p.id}`,name:p.name,parent:'owner',specialist:p.id}))],assignments:{}};
}
export function validateChart(data:unknown, available:Set<string>, accounts:Set<string>): OrgChart {
  const c=data as OrgChart;
  if(!c || c.version!==1 || !Array.isArray(c.nodes) || !c.nodes.length || c.nodes.length>100 || !c.assignments || typeof c.assignments!=='object' || Array.isArray(c.assignments)) throw new Error('Enter a chart with 1 to 100 positions');
  const ids=new Set<string>(),roles=new Set<string>();
  const nodes=c.nodes.map(n=>{
    if(!n || !nodeId(n.id) || ids.has(n.id) || typeof n.name!=='string' || !n.name.trim() || n.name.length>80 || (n.parent!==undefined && !nodeId(n.parent))) throw new Error('Each position needs a unique ID and a name up to 80 characters');
    ids.add(n.id);
    if(n.specialist!==undefined){if(!specialistId(n.specialist) || !available.has(n.specialist) || roles.has(n.specialist)) throw new Error('Each specialist can occupy one position and must be a saved role');roles.add(n.specialist);}
    return {id:n.id,name:n.name.trim(),...(n.parent?{parent:n.parent}:{}),...(n.specialist?{specialist:n.specialist}:{})};
  });
  if(nodes.filter(n=>!n.parent).length!==1) throw new Error('The chart must have one top position');
  const map=new Map(nodes.map(n=>[n.id,n]));
  for(const n of nodes) {
    const seen=new Set([n.id]);let parent=n.parent;
    while(parent){if(!map.has(parent))throw new Error('Every manager must be a position in this chart');if(seen.has(parent))throw new Error('Reporting relationships cannot contain a cycle');seen.add(parent);parent=map.get(parent)?.parent;}
  }
  const assignments:Record<string,string>={};
  for(const [id,position] of Object.entries(c.assignments)) {
    if(!accounts.has(id) || typeof position!=='string' || !ids.has(position)) throw new Error('Assign existing employee accounts to existing positions');
    assignments[id]=position;
  }
  return {version:1,nodes,assignments};
}
export function readChart(root:string): OrgChart {
  const file=path.join(root,'.agent-office','org-chart.json');
  if(!fs.existsSync(file))return defaultChart(root);
  if(fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size>100000)throw new Error('Org chart configuration is invalid');
  try {
    const raw=JSON.parse(fs.readFileSync(file,'utf8'));
    // Revoked accounts may remain in the saved chart, but cannot authenticate or hire.
    return validateChart(raw,new Set(profiles(root).map(p=>p.id)),new Set(Object.keys(raw.assignments??{})));
  }catch{throw new Error('Org chart configuration is invalid. An admin must repair it before employees can hire.');}
}
export function saveChart(root:string,data:unknown,accounts:OrgAccount[]): OrgChart {
  const chart=validateChart(data,new Set(profiles(root).map(p=>p.id)),new Set(accounts.map(a=>a.id)));
  const dir=path.join(root,'.agent-office');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'org-chart.json'),tmp=`${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {fs.writeFileSync(tmp,JSON.stringify(chart,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  return chart;
}
export function employeeHireError(root:string,accounts: Pick<Accounts,'get'>,owner:string|undefined,specialist:string|undefined,kind='agent'): string|undefined {
  if(!owner)return; // Shared-password access and office automation have administrator privileges.
  const account=accounts.get(owner);
  if(!account)return 'Your account is no longer active';
  if(account.role==='admin')return;
  if(kind!=='agent' || !specialist)return 'Employees can hire only specialist agents below their org-chart position';
  try {if(allowedSpecialists(readChart(root),owner).includes(specialist))return;}catch{return 'Hiring is blocked because the org chart needs an admin to repair it';}
  return 'This specialist is not below your assigned org-chart position';
}
