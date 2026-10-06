import type http from 'node:http';
import path from 'node:path';
import { nextFreeSeat } from '../../shared/layout.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { Floor } from '../floor.js';
import { readBody, send } from '../http/util.js';
import type { Ctx } from '../office/context.js';
import { str } from '../office/input.js';
import { sendToWorker } from '../worker-chat/send.js';
import { conversation } from '../worker-chat/transcripts.js';
import { codexPlanUsage } from './codex-limits.js';
import { assistantOf, claudePlan } from './runner.js';

// /office/assistant/* on the hook server (127.0.0.1 only), for the executive assistant's `office` command (bin/office.js):
// every agent on every floor, one agent's latest, telling, interrupting, waking, sending home and hiring, and the
// plans' usage. Only the assistant's own token opens it (runner.ts); what it does is done as "Assistant".

const BY = 'Assistant';
const ago = (at: number | undefined) => (at ? Math.max(0, Math.round((Date.now() - at) / 60_000)) : undefined);
const clip = (s: string | undefined, n: number) => (!s ? undefined : s.length > n ? `${s.slice(0, n - 1)}\u2026` : s);

function row(f: Floor, w: WorkerInfo) {
  const tokens = w.usage ? (w.usage.totalTokens ?? w.usage.input + w.usage.output + w.usage.cacheRead + w.usage.cacheWrite) : undefined;
  return {
    id: w.id,
    name: w.name,
    floor: f.def.name,
    floorId: f.id,
    status: w.status,
    kind: w.kind,
    provider: w.provider,
    model: w.usage?.model ?? w.model,
    specialist: w.specialist,
    task: clip(w.task?.name ?? w.title ?? w.prompt, 160),
    doing: clip(w.activity, 200),
    waitingMinutes: w.status === 'needs_input' || w.status === 'done' ? ago(w.waitingSince) : undefined,
    lastToldMinutesAgo: ago(w.lastInput?.at),
    hiredBy: w.createdBy,
    hiredMinutesAgo: ago(w.createdAt),
    branch: w.worktree?.branch,
    pr: w.pr ? { number: w.pr.number, url: w.pr.url } : undefined,
    tokens,
    costUsd: w.usage?.costKnown === false ? undefined : w.usage?.cost,
  };
}

/** An agent by id, or by name on any floor (one name on two floors has to be said by id). */
function find(ctx: Ctx, who: string): { f: Floor; w: WorkerInfo } | string {
  const key = who.trim().toLowerCase();
  if (!key) return 'Say which agent';
  const all = [...ctx.floors.values()].flatMap((f) => f.workers.list().map((w) => ({ f, w })));
  const byId = all.find((x) => x.w.id === who.trim());
  if (byId) return byId;
  const named = all.filter((x) => x.w.name.toLowerCase() === key);
  if (named.length === 1) return named[0];
  if (named.length > 1) return `${named.length} agents are called ${who}: say which by id (${named.map((x) => `${x.w.id} on ${x.f.def.name}`).join(', ')})`;
  return `No agent called ${who}`;
}

export async function officeAssistant(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!assistantOf(ctx).authenticate(token)) return send(res, 401, { error: 'Only the assistant uses this' });
  const action = url.pathname.slice('/office/assistant'.length).replace(/^\//, '') || 'agents';
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    try {
      const raw = await readBody(req, 64_000);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return send(res, 400, { error: 'Invalid request' });
    }
  }
  const floors = [...ctx.floors.values()];

  if (action === 'agents') {
    return send(res, 200, { floors: floors.map((f) => ({ id: f.id, name: f.def.name })), agents: floors.flatMap((f) => f.workers.list().map((w) => row(f, w))) });
  }
  if (action === 'usage') {
    ctx.limits.refresh();
    const agents = floors.flatMap((f) => f.workers.list().map((w) => row(f, w)));
    return send(res, 200, {
      plans: [await codexPlanUsage(), claudePlan(ctx.limits.state)].filter(Boolean),
      claudeSpend: ctx.ledger.state(),
      working: agents.filter((a) => a.status === 'working' || a.status === 'starting').length,
      agents: agents.length,
      capacity: ctx.machine.limit,
      byAgent: agents.map((a) => ({ name: a.name, floor: a.floor, status: a.status, provider: a.provider, model: a.model, tokens: a.tokens, costUsd: a.costUsd })),
    });
  }

  const target = find(ctx, str(url.searchParams.get('agent') ?? body.agent, 80));
  if (action === 'agent') {
    if (typeof target === 'string') return send(res, 404, { error: target });
    const w = target.f.workers.sessionContext(target.w.id);
    const said = w && w.info.kind === 'agent' ? await conversation(w, path.join(target.f.dir, '.agent-office')).catch(() => []) : [];
    return send(res, 200, { agent: row(target.f, target.w), prompt: clip(target.w.prompt, 2000), conversation: said.slice(-10).map((m) => ({ role: m.role, at: m.at, text: clip(m.text, 900) })) });
  }
  if (action === 'hire') {
    const where = str(body.floor, 80).toLowerCase();
    const f = floors.find((x) => x.id === where || x.def.name.toLowerCase() === where) ?? (floors.length === 1 ? floors[0] : undefined);
    if (!f) return send(res, 404, { error: `Say which floor: ${floors.map((x) => `${x.def.name} (${x.id})`).join(', ')}` });
    const task = str(body.task, 20_000).trim();
    if (!task) return send(res, 400, { error: 'Say what the task is' });
    const desk = nextFreeSeat((id) => f.workers.deskOccupied(id), f.plan.wing)?.id;
    if (!desk) return send(res, 409, { error: `Every desk on ${f.def.name} is taken: send someone home first` });
    const specialist = str(body.specialist, 80) || undefined;
    const provider = body.provider === 'claude' || body.provider === 'codex' ? body.provider : undefined;
    const worktree = !specialist && !!f.project.branch;
    if (worktree) await f.workers.fetchBase();
    const r = f.workers.spawn(desk, BY, task, worktree, 'agent', provider, undefined, undefined, undefined, undefined, [], specialist);
    if (typeof r === 'string') return send(res, 400, { error: r });
    ctx.toastFloor(f, `\u{1f9d1}\u200d\u{1f4bc} The assistant hired ${r.name} with a task`);
    return send(res, 200, { ok: true, agent: row(f, r) });
  }

  if (typeof target === 'string') return send(res, 404, { error: target });
  const { f, w } = target;
  if (action === 'tell') {
    if (w.kind !== 'agent') return send(res, 400, { error: `${w.name} is a shell, not an agent` });
    const text = str(body.text, 20_000).trim();
    if (!text) return send(res, 400, { error: 'Say what to tell it' });
    const sent = sendToWorker(f, w.id, text, `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, BY);
    return send(res, sent.status, sent.body);
  }
  if (action === 'interrupt') {
    if (w.status !== 'working') return send(res, 409, { error: `${w.name} isn't working (${w.status})` });
    f.workers.write(w.id, '\x1b', BY);
    return send(res, 200, { ok: true });
  }
  if (action === 'wake') {
    const err = f.workers.resume(w.id);
    return err ? send(res, 400, { error: err }) : send(res, 200, { ok: true });
  }
  if (action === 'home') {
    const busy = w.status === 'working' || w.status === 'starting' || w.status === 'needs_input';
    if (busy && body.force !== true) return send(res, 409, { error: `${w.name} is ${w.status === 'needs_input' ? 'waiting on someone' : 'working'}: only send it home when you were told to, with --force` });
    const why = str(body.why, 200).trim();
    ctx.toastFloor(f, why ? `\u{1f3e0} The assistant sent ${w.name} home: ${why}` : `\u{1f3e0} The assistant sent ${w.name} home`);
    // No cleanup said: its worktree and branch go only when its work is all on GitHub (floor.sendHome).
    const { note, error } = await f.sendHome(w.id);
    if (note) ctx.toastFloor(f, note);
    return send(res, error ? 500 : 200, { ok: !error, ...(note ? { note } : {}), ...(error ? { error } : {}) });
  }
  return send(res, 404, { error: 'Not a command' });
}
