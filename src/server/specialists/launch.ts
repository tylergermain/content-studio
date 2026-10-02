import fs from 'node:fs';
import path from 'node:path';
import { readSpecialistJson, specialistFolder } from './profiles.js';
import type { LaunchPlan } from '../providers/types.js';
import type { WorkerInfo } from '../../shared/protocol.js';

/** Add native provider tools without replacing its hooks, session or authentication. */
export function specialistLaunch(plan: LaunchPlan, info: WorkerInfo, root: string): LaunchPlan {
  if(!info.specialist) return plan;
  const folder=specialistFolder(root,info.specialist), file=path.join(folder,'mcp.local.json');
  if(!fs.existsSync(file)) return plan;
  if(fs.lstatSync(file).isSymbolicLink()) throw new Error('MCP configuration must be a local file');
  fs.chmodSync(file,0o600);
  const servers=readSpecialistJson(file).mcpServers;
  if(!servers || typeof servers!=='object' || Array.isArray(servers)) throw new Error('mcp.local.json needs an mcpServers object');
  if(!Object.keys(servers).length) return plan;
  if(info.provider==='pi') throw new Error('Pi needs an MCP adapter to use specialist tools');
  const ignore=path.join(root,'.gitignore');
  if(fs.existsSync(ignore) && fs.lstatSync(ignore).isSymbolicLink()) throw new Error('.gitignore must be a local file');
  if(!fs.existsSync(ignore) || !fs.readFileSync(ignore,'utf8').split('\n').includes('/agents/*/mcp.local.json')) fs.appendFileSync(ignore,'\n/agents/*/mcp.local.json\n');
  const args:string[]=[];
  const env={...plan.env};
  for(const [name,raw] of Object.entries(servers)) {
    if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error('MCP server names must use letters, numbers, underscores or hyphens');
    const server=raw as Record<string,unknown>;
    if(!server || typeof server!=='object' || Array.isArray(server)) throw new Error('Invalid MCP server');
    for(const field of ['command','url','cwd','bearer_token_env_var']) if(server[field]!==undefined && typeof server[field]!=='string') throw new Error('MCP command, URL and environment references must be strings');
    if(server.args!==undefined && (!Array.isArray(server.args) || !server.args.every(a=>typeof a==='string'))) throw new Error('MCP args must be an array of strings');
    if(info.provider==='codex') {
      const key=`mcp_servers.${name}`;
      for(const field of ['command','args','url','cwd']) if(server[field]!==undefined) args.push('-c',`${key}.${field}=${JSON.stringify(server[field])}`);
      if(server.env && typeof server.env==='object') {
        const names:string[]=[];
        for(const [k,v] of Object.entries(server.env as object)) {
          if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) || typeof v!=='string') throw new Error('Invalid MCP environment');
          if(env[k]!==undefined && env[k]!==v) throw new Error('MCP servers must use distinct environment variable names');
          env[k]=v;names.push(k);
        }
        if(!server.url) args.push('-c',`${key}.env_vars=${JSON.stringify(names)}`);
      }
      if(server.http_headers) throw new Error('For Codex use env_http_headers or bearer_token_env_var instead of inline secret headers');
      if(server.bearer_token_env_var!==undefined) args.push('-c',`${key}.bearer_token_env_var=${JSON.stringify(server.bearer_token_env_var)}`);
      if(server.env_http_headers && typeof server.env_http_headers==='object') for(const [k,v] of Object.entries(server.env_http_headers as object)) {
        if(!/^[a-zA-Z0-9_-]+$/.test(k) || typeof v!=='string') throw new Error('Invalid MCP header environment mapping');
        args.push('-c',`${key}.env_http_headers.${JSON.stringify(k)}=${JSON.stringify(v)}`);
      }
    }
  }
  const launchArgs=[...plan.args];
  if(info.provider==='claude') { const at=launchArgs.indexOf('--mcp-config'); if(at>=0) launchArgs.splice(at+1,0,file); else args.push('--mcp-config',file); }
  return {...plan,env,args:[...args,...launchArgs]};
}
