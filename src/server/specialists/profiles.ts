import fs from 'node:fs';
import path from 'node:path';
import { specialistId, type SpecialistProfile } from '../../shared/specialists.js';
import { STARTER_WORKSPACES, isWorkspaceKind, workspaceOf, type WorkspaceKind } from '../../shared/workspace.js';

const common = `The floor root is ../../ from this specialist folder. Resolve shared content and output paths relative to that floor root. Read the floor's README.md and AGENTS.md and follow its relevant profiles and playbooks. Keep work in the existing content project, with each YouTube video's files together under outputs/youtube/<slug>/. Do not publish or send messages without explicit authorization. Never commit credentials or local authentication. Never use em dashes or choppy slogans. This folder is your working context, not an enforced sandbox. Coordinate shared files with other workers. Link each deliverable in your reply as a Markdown link to its full path, in angle brackets when the path has spaces, and save each new version as a new file (name-v02, name-v03) instead of overwriting one you already shared.\n`;
export const starters: SpecialistProfile[] = [
  { id:'video-editor',name:'Video Editor',instructions:common+'Edit footage non-destructively, preview the result, and report the output path. Use installed editing skills and tools when available. On the Mac Studio, production assets are in /Users/fridaylabs/Desktop/Content. Inspect the relevant project before using assets and never move or overwrite originals. Keep renders and project files in the relevant content project.\n',tools:[],workspace:STARTER_WORKSPACES['video-editor'] },
  { id:'researcher',name:'Researcher',instructions:common+'Research content ideas and claims using primary sources, record source links and dates, and distinguish verified facts from assumptions. Read the content archive strategist skill before proposing new ideas when available. Keep research notes in the relevant existing project.\n',tools:[],workspace:STARTER_WORKSPACES.researcher },
  { id:'designer',name:'Designer',instructions:common+'Create thumbnails, graphics, and content layouts using the relevant brand and design skills. Read the voice, audience, and content pillar profiles. Preserve editable source files, preview your work, and keep exports in the relevant content project.\n',tools:[],workspace:STARTER_WORKSPACES.designer },
];

export function specialistFolder(root: string, id: string): string {
  if (!specialistId(id)) throw new Error('Invalid specialist ID');
  const realRoot=fs.realpathSync(root), folder=path.join(realRoot,'agents',id);
  for(const dir of [path.dirname(folder),folder]) {
    if(fs.existsSync(dir) && (fs.lstatSync(dir).isSymbolicLink() || !fs.statSync(dir).isDirectory())) throw new Error('Specialist folders must be ordinary directories');
  }
  return folder;
}
export function readSpecialistJson(file: string): any {
  if(fs.statSync(file).size>65536) throw new Error('Specialist configuration is too large');
  try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { throw new Error('Invalid specialist JSON configuration'); }
}
function toolNames(folder: string): string[] {
  const file=path.join(folder,'mcp.local.json');
  if (!fs.existsSync(file)) return [];
  if(fs.lstatSync(file).isSymbolicLink()) throw new Error('MCP configuration must be a local file');
  const data=readSpecialistJson(file);
  if(!data || !data.mcpServers || typeof data.mcpServers !== 'object' || Array.isArray(data.mcpServers)) throw new Error('mcp.local.json needs an mcpServers object');
  return Object.keys(data.mcpServers);
}
export function profiles(root: string): SpecialistProfile[] {
  const list=new Map<string,SpecialistProfile>(starters.map(p=>[p.id,{...p,tools:[]} ]));
  const agents=path.join(fs.realpathSync(root),'agents');
  if(fs.existsSync(agents)) {
    if(fs.lstatSync(agents).isSymbolicLink()) throw new Error('Specialist folders must be ordinary directories');
    for(const id of fs.readdirSync(agents)) {
      if(!specialistId(id)) continue;
      const folder=specialistFolder(root,id), file=path.join(folder,'profile.json');
      if(!fs.existsSync(file) && !list.has(id)) continue;
      if(fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Profile must be a local file');
      const data=fs.existsSync(file)?readSpecialistJson(file):list.get(id)!;
      const instructionsFile=path.join(folder,'AGENTS.md');
      if(!fs.existsSync(instructionsFile)) continue;
      if(fs.lstatSync(instructionsFile).isSymbolicLink()) throw new Error('Instructions must be a local file');
      list.set(id,{id,name:String(data.name).slice(0,60),instructions:fs.readFileSync(instructionsFile,'utf8'),tools:toolNames(folder),workspace:workspaceOf(id,data.workspace)});
    }
  }
  return [...list.values()];
}
export function saveProfile(root: string, data: unknown): SpecialistProfile {
  const p=data as Partial<SpecialistProfile>;
  if(!p || !specialistId(p.id) || typeof p.name!=='string' || !p.name.trim() || p.name.length>60 || typeof p.instructions!=='string' || !p.instructions.trim() || p.instructions.length>30000) throw new Error('Enter an ID, a name up to 60 characters, and instructions up to 30,000 characters');
  if(p.workspace!=null && !isWorkspaceKind(p.workspace)) throw new Error('Choose an interface for this specialist');
  const folder=specialistFolder(root,p.id);fs.mkdirSync(folder,{recursive:true});
  for(const name of ['AGENTS.md','CLAUDE.md','profile.json']) if(fs.existsSync(path.join(folder,name)) && fs.lstatSync(path.join(folder,name)).isSymbolicLink()) throw new Error('Profile files must be ordinary local files');
  const ignore=path.join(root,'.gitignore');
  if(fs.existsSync(ignore) && fs.lstatSync(ignore).isSymbolicLink()) throw new Error('.gitignore must be a local file');
  if(!fs.existsSync(ignore) || !fs.readFileSync(ignore,'utf8').split('\n').includes('/agents/*/mcp.local.json')) fs.appendFileSync(ignore,'\n/agents/*/mcp.local.json\n');
  const local=path.join(folder,'mcp.local.json');
  if(!fs.existsSync(local)) fs.writeFileSync(local,'{"mcpServers":{}}\n',{mode:0o600});
  fs.writeFileSync(path.join(folder,'AGENTS.md'),p.instructions.trim()+'\n');
  if(!fs.existsSync(path.join(folder,'CLAUDE.md'))) fs.writeFileSync(path.join(folder,'CLAUDE.md'),'Read and follow AGENTS.md in this folder and the parent content workspace.\n');
  // A save that names no interface keeps the one the role has.
  const workspace=p.workspace ?? declaredWorkspace(path.join(folder,'profile.json'));
  fs.writeFileSync(path.join(folder,'profile.json'),JSON.stringify({id:p.id,name:p.name.trim(),...(workspace?{workspace}:{})},null,2)+'\n');
  roles.delete(`${p.id}:${root}`);
  return {id:p.id,name:p.name.trim(),instructions:p.instructions.trim(),tools:toolNames(folder),workspace:workspaceOf(p.id,workspace)};
}
/** The interface a profile.json names, when it is a local file that names a real one. */
function declaredWorkspace(file: string): WorkspaceKind | undefined {
  try {
    if(!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) return undefined;
    const kind=readSpecialistJson(file)?.workspace;
    return isWorkspaceKind(kind)?kind:undefined;
  } catch { return undefined; }
}
const roles=new Map<string,{at:number;kind:WorkspaceKind}>();
/**
 * The interface a role's workers open with, for the chat snapshot: what its profile.json declares, else
 * its starter's, else Files. It reads only that role's profile, keeps the answer 10 seconds, and never
 * throws: a broken role folder opens as Files (or its starter's kind).
 */
export function roleWorkspace(root: string, specialist: string | undefined): WorkspaceKind {
  if(!specialist) return 'files';
  const key=`${specialist}:${root}`, hit=roles.get(key);
  if(hit && Date.now()-hit.at<10000) return hit.kind;
  let kind=workspaceOf(specialist);
  try { kind=workspaceOf(specialist,declaredWorkspace(path.join(specialistFolder(root,specialist),'profile.json'))); } catch { /* An invalid ID or a symlinked agents/ folder. */ }
  if(roles.size>256) roles.clear();
  roles.set(key,{at:Date.now(),kind});
  return kind;
}
export function prepareSpecialist(root: string, id: string, provider?: string): SpecialistProfile {
  const p=profiles(root).find(p=>p.id===id);if(!p) throw new Error('No such specialist');
  if(provider==='pi' && p.tools.length) throw new Error('Pi needs an MCP adapter. Remove this specialist’s MCP configuration or choose Claude Code or Codex.');
  if(!fs.existsSync(path.join(specialistFolder(root,id),'profile.json'))) saveProfile(root,p);
  return p;
}
