import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { LibrarySkill, SkillDocument, SkillVersion } from '../../shared/skill-library.js';

const idOk = (s: string) => /^[a-z0-9][a-z0-9-]{0,119}$/.test(s);
const git = (root: string, args: string[]) => { const result=execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024, env: {...process.env, GIT_TERMINAL_PROMPT:'0', GIT_CONFIG_NOSYSTEM:'1'} });return args[0]==='show'?result:result.trimEnd(); };
export function libraryRoot(floor: string): string {
 const root=path.join(fs.realpathSync(floor),'skill-library');
 if(fs.existsSync(root) && (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()))throw new Error('The skill library must be a local directory');
 if(fs.existsSync(path.join(root,'.git'))&&fs.lstatSync(path.join(root,'.git')).isSymbolicLink())throw new Error('The library Git directory must be local');
 return root;
}
function file(root: string,id: string): string {
 if(!idOk(id))throw new Error('Invalid skill ID');
 const p=path.join(root,'skills',id,'SKILL.md');
 for(const part of [path.join(root,'skills'),path.dirname(p),p])if(fs.existsSync(part)&&fs.lstatSync(part).isSymbolicLink())throw new Error('Skill links are not supported');
 if(!fs.existsSync(p)||fs.statSync(p).size>1024*1024)throw new Error('Skill unavailable or too large');
 return p;
}
function field(text: string,key: string): string {
 const header=/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]??'';
 const value=(new RegExp(`^${key}:\\s*(.*)$`,'m').exec(header)?.[1]??'').replace(/^['"]|['"]$/g,'').trim();
 if(!/^[>|][-+]?$/.test(value))return value;
 const block=new RegExp(`^${key}:.*\\n((?:[ \t]+.*(?:\\n|$))+)`,'m').exec(header)?.[1]??'';
 return block.split('\n').map(s=>s.trim()).join(' ').trim();
}
function metadata(root: string,id: string,info?: {version:string;dirty:boolean}): LibrarySkill {
 const text=fs.readFileSync(file(root,id),'utf8'),rel=`skills/${id}/SKILL.md`;
 let version=info?.version??'',dirty=info?.dirty??false;
 if(!info)try{version=git(root,['log','-1','--format=%h','--',rel]);dirty=!!git(root,['status','--porcelain','--',rel]);}catch{}
 return {id,name:field(text,'name')||/^#\s+(.+)$/m.exec(text)?.[1]||id,description:field(text,'description'),category:field(text,'library-category')||'Other',version,dirty};
}
export function listSkills(floor: string): LibrarySkill[] {
 const root=libraryRoot(floor),dir=path.join(root,'skills');if(!fs.existsSync(dir))return [];
 if(fs.lstatSync(dir).isSymbolicLink())throw new Error('Skill links are not supported');
 const latest=new Map<string,string>(),dirty=new Set<string>();
 try {
  let commit='';
  for(const line of git(root,['log','-1000','--format=@@%h','--name-only','--','skills']).split('\n')) {
   if(line.startsWith('@@'))commit=line.slice(2);
   else if(line&&commit&&!latest.has(line))latest.set(line,commit);
  }
  for(const line of git(root,['status','--porcelain','--','skills']).split('\n'))dirty.add(line.slice(3));
 }catch{}
 return fs.readdirSync(dir).filter(idOk).filter(id=>fs.existsSync(path.join(dir,id,'SKILL.md'))).map(id=>{const rel=`skills/${id}/SKILL.md`;return metadata(root,id,{version:latest.get(rel)||'',dirty:dirty.has(rel)});}).sort((a,b)=>a.name.localeCompare(b.name));
}
function revision(root: string,value?: string): string {
 const ref=value||'HEAD';if(ref!=='HEAD'&&!/^[a-f0-9]{7,40}$/.test(ref))throw new Error('Invalid version');
 const sha=git(root,['rev-parse','--verify',`${ref}^{commit}`]);
 if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('Version unavailable');
 return sha;
}
export function readSkill(floor: string,id: string,version?: string): SkillDocument {
 const root=libraryRoot(floor),p=file(root,id),rel=`skills/${id}/SKILL.md`,head=revision(root);
 const selected=version?revision(root,version):head;
 const text=version?git(root,['show',`${selected}:${rel}`]):fs.readFileSync(p,'utf8');
 const log=git(root,['log','-40','--format=%H%x09%aI%x09%s','--',rel]);
 const versions:SkillVersion[]=log.split('\n').filter(Boolean).map(line=>{const[id,date,...message]=line.split('\t');return{id,date,message:message.join('\t')};});
 const diff=version?git(root,['diff',`${selected}`, '--',rel]):git(root,['diff','HEAD','--',rel]);
 return {skill:metadata(root,id),text,versions,revision:head,diff};
}
export function saveSkill(floor: string,id: string,text: string,expected: string,message: string,restore?: string): SkillDocument {
 const root=libraryRoot(floor),p=file(root,id),rel=`skills/${id}/SKILL.md`;
 if(revision(root)!==expected)throw new Error('The library changed. Reload before saving.');
 if(git(root,['status','--porcelain']))throw new Error('The library has uncommitted changes. Commit or resolve them before editing.');
 if(restore)text=git(root,['show',`${revision(root,restore)}:${rel}`]);
 if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>1024*1024)throw new Error('Skill text must be between 1 byte and 1 MiB');
 if(typeof message!=='string'||!message.trim()||message.length>200)throw new Error('Add a short version note');
 const original=fs.readFileSync(p,'utf8');if(text===original)return readSkill(floor,id);
 const temp=p+'.tmp';fs.writeFileSync(temp,text,{mode:0o600,flag:'wx'});fs.renameSync(temp,p);
 try {
  git(root,['add','--',rel]);git(root,['-c','user.name=Content Studio','-c','user.email=content-studio@localhost','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','-m',`${restore?'Restore':'Update'} ${id}: ${message.trim()}`,'--',rel]);
 }catch{fs.writeFileSync(p,original,{mode:0o600});try{git(root,['reset','HEAD','--',rel]);}catch{}throw new Error('Could not record the version. Original instructions restored.');}
 return readSkill(floor,id);
}
