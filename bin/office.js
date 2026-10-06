#!/usr/bin/env node
// office: the executive assistant's command (src/server/assistant/), for every agent on every floor of Agent Office.
// The office runs the assistant with AGENT_OFFICE_HOOK_URL and AGENT_OFFICE_ASSISTANT_TOKEN set, and this talks to
// /office/assistant/* with them. It prints JSON. Plain Node, no build step, no dependencies.

const USAGE = `Usage:
  office agents                                   every agent on every floor
  office agent <name|id>                          one agent, with the end of its conversation
  office usage                                    plans' usage, spend, and each agent's tokens
  office tell <name|id> "<message>"               send an agent a message (wakes it if asleep)
  office interrupt <name|id>                      stop what an agent is doing
  office wake <name|id>                           start an asleep agent again
  office home <name|id> [--why "<reason>"] [--force]
                                                  send an agent home (--force: even if working)
  office hire <floor> "<task>" [--specialist <id>] [--provider codex|claude]
                                                  start a new agent on a floor`;

function flag(args, name) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, v !== undefined && !v.startsWith('--') ? 2 : 1);
  return v !== undefined && !v.startsWith('--') ? v : true;
}

async function main(argv) {
  const url = (process.env.AGENT_OFFICE_HOOK_URL || '').replace(/\/+$/, '');
  const token = process.env.AGENT_OFFICE_ASSISTANT_TOKEN || '';
  const [verb, ...rest] = argv;
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') {
    console.log(USAGE);
    return verb ? 0 : 2;
  }
  if (!url || !token) {
    console.error('office: only the office’s assistant can use this (AGENT_OFFICE_HOOK_URL and AGENT_OFFICE_ASSISTANT_TOKEN aren’t set)');
    return 2;
  }
  const args = [...rest];
  let method = 'POST', path = verb, body;
  if (verb === 'agents' || verb === 'usage') method = 'GET';
  else if (verb === 'agent') {
    method = 'GET';
    path = `agent?agent=${encodeURIComponent(args.join(' '))}`;
  } else if (verb === 'tell') body = { agent: args[0], text: args.slice(1).join(' ') };
  else if (verb === 'interrupt' || verb === 'wake') body = { agent: args.join(' ') };
  else if (verb === 'home') {
    const why = flag(args, 'why'), force = flag(args, 'force');
    body = { agent: args.join(' '), ...(typeof why === 'string' ? { why } : {}), force: force === true };
  } else if (verb === 'hire') {
    const specialist = flag(args, 'specialist'), provider = flag(args, 'provider');
    body = { floor: args[0], task: args.slice(1).join(' '), ...(typeof specialist === 'string' ? { specialist } : {}), ...(typeof provider === 'string' ? { provider } : {}) };
  } else {
    console.error(`office: no command ${verb}\n${USAGE}`);
    return 2;
  }
  const res = await fetch(`${url}/office/assistant/${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: `The office didn’t answer: ${e.message}` }) }));
  const out = await res.json().catch(() => ({ error: `The office answered ${res.status}` }));
  console.log(JSON.stringify(out, null, 1));
  return res.ok ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
