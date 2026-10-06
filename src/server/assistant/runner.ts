import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AssistantMessage, AssistantState, PlanUsage } from '../../shared/assistant.js';
import type { PlanLimits } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import { ASSISTANT_BRIEF, BRIEF_VERSION } from './brief.js';
import { codexPlanUsage } from './codex-limits.js';
import { writeOfficeCommands } from '../workers/process.js';
import { CODEX_KEY_ENV, codexRouteArgs, inferenceRoute } from '../friday-proxy/route.js';

// The executive assistant: an agent with no desk and no body, in the Agents panel. Each question is one turn of a
// Codex conversation run headless (`codex exec --json`, then `codex exec resume <thread>` for the next), in its own
// folder (<office data>/assistant) with its brief as AGENTS.md and the `office` command on its PATH, which reaches
// /office/assistant/* (tools.ts) with a token only this office holds. Questions wait their turn; the conversation and
// the tokens its turns used are kept in that folder's state.json, so it carries on after a restart.

const TURN_MS = 6 * 60_000;
const KEEP = 200;
const CODEX = process.env.AGENT_OFFICE_ASSISTANT_CODEX || 'codex';

interface Saved {
  thread?: string;
  messages: AssistantMessage[];
  used: AssistantState['used'];
}

const instances = new WeakMap<Ctx, Assistant>();
/** The office's assistant, made the first time anyone asks for it. */
export function assistantOf(ctx: Ctx): Assistant {
  let a = instances.get(ctx);
  if (!a) instances.set(ctx, (a = new Assistant(ctx)));
  return a;
}

/** Claude's plan usage as Claude Code reported it (server/limits.ts), when it has. */
export function claudePlan(l: PlanLimits | undefined): PlanUsage | undefined {
  if (!l?.windows?.length) return undefined;
  return { provider: 'claude', ...(l.plan ? { plan: l.plan } : {}), windows: l.windows.map((w) => ({ label: w.label, pct: w.pct, ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}) })), at: l.at ?? Date.now() };
}

/** What a command it ran was, in a few words: the office command and its first argument. */
export function stepOf(command: string): string {
  const m = /\boffice\s+([a-z-]+)(?:\s+("[^"]*"|'[^']*'|\S+))?/.exec(command);
  if (!m) return command.replace(/^(?:\/bin\/)?(?:ba|z)?sh\s+-lc\s+/, '').replace(/^['"]|['"]$/g, '').slice(0, 80);
  const arg = m[2]?.replace(/^['"]|['"]$/g, '');
  return `office ${m[1]}${arg && !arg.startsWith('-') ? ` ${arg}` : ''}`;
}

export class Assistant {
  readonly dir: string;
  private token = randomBytes(24).toString('hex');
  private saved: Saved;
  private queue: { text: string; by: string }[] = [];
  private child: ChildProcess | undefined;
  private doing: string[] = [];
  private error: string | undefined;

  constructor(private ctx: Ctx) {
    this.dir = path.join(ctx.cfg.dataDir, 'assistant');
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    // Its brief, written again when the office's own changes; one someone edited (the mark taken out) is theirs.
    const brief = path.join(this.dir, 'AGENTS.md');
    const was = existsSync(brief) ? readFileSync(brief, 'utf8') : '';
    if (!was || (/<!-- agent-office assistant v\d+ -->/.test(was) && !was.includes(`<!-- agent-office assistant v${BRIEF_VERSION} -->`))) writeFileSync(brief, ASSISTANT_BRIEF, { mode: 0o600 });
    this.saved = this.load();
    // Its `office` command, beside the workers' own (workers/process.ts).
    writeOfficeCommands(ctx.cfg.dataDir);
  }

  authenticate(token: string): boolean {
    const a = Buffer.from(token), b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private load(): Saved {
    try {
      const s = JSON.parse(readFileSync(path.join(this.dir, 'state.json'), 'utf8')) as Partial<Saved>;
      const messages = (Array.isArray(s.messages) ? s.messages : []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && typeof m.at === 'number');
      const u = (s.used ?? {}) as Partial<Saved['used']>;
      return { ...(typeof s.thread === 'string' ? { thread: s.thread } : {}), messages, used: { input: Number(u.input) || 0, cached: Number(u.cached) || 0, output: Number(u.output) || 0, turns: Number(u.turns) || 0 } };
    } catch {
      return { messages: [], used: { input: 0, cached: 0, output: 0, turns: 0 } };
    }
  }
  private save() {
    const file = path.join(this.dir, 'state.json');
    this.saved.messages = this.saved.messages.slice(-KEEP);
    writeFileSync(`${file}.tmp`, JSON.stringify(this.saved), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }

  async view(): Promise<AssistantState> {
    this.ctx.limits.refresh();
    const plans = [await codexPlanUsage(), claudePlan(this.ctx.limits.state)].filter((p): p is PlanUsage => !!p);
    return { busy: !!this.child, doing: this.doing, queued: this.queue.length, messages: this.saved.messages, plans, used: this.saved.used, ...(this.error ? { error: this.error } : {}) };
  }

  ask(text: string, by: string) {
    this.saved.messages.push({ id: `u${Date.now().toString(36)}${randomBytes(3).toString('hex')}`, role: 'user', text, at: Date.now(), by });
    this.save();
    this.queue.push({ text, by });
    this.pump();
  }

  /** A new conversation: it forgets what was said (its brief stays). */
  reset() {
    this.queue = [];
    this.child?.kill('SIGTERM');
    this.saved = { messages: [], used: { input: 0, cached: 0, output: 0, turns: 0 } };
    this.error = undefined;
    this.save();
  }

  private pump() {
    if (this.child || !this.queue.length) return;
    this.run(this.queue.shift()!);
  }

  private run(q: { text: string; by: string }) {
    let hookUrl = '';
    try {
      hookUrl = `http://127.0.0.1:${Number(readFileSync(path.join(this.ctx.cfg.dataDir, 'hook-port'), 'utf8'))}`;
    } catch {
      /* the hook server writes it as it starts */
    }
    const bin = path.join(this.ctx.cfg.dataDir, 'bin');
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: [bin, process.env.PATH].filter(Boolean).join(path.delimiter), AGENT_OFFICE_HOOK_URL: hookUrl, AGENT_OFFICE_ASSISTANT_TOKEN: this.token };
    for (const k of ['AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_HOOK_TOKEN']) delete env[k];
    const flags = ['--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox'];
    // Friday Proxy on for Codex: the assistant's inference goes through it too (see friday-proxy/route.ts).
    const route = inferenceRoute('codex');
    if (route) env[CODEX_KEY_ENV] = route.apiKey;
    const routeArgs = route ? codexRouteArgs(route) : [];
    const args = this.saved.thread ? [...routeArgs, 'exec', 'resume', ...flags, this.saved.thread, '-'] : [...routeArgs, 'exec', ...flags, '-C', this.dir, '-'];
    const when = new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const prompt = `[${when} \u00b7 ${q.by}]\n${q.text}`;
    this.doing = [];
    this.error = undefined;
    const said: string[] = [];
    let child: ChildProcess;
    try {
      child = spawn(CODEX, args, { cwd: this.dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return this.finish([], `Couldn\u2019t start Codex: ${e instanceof Error ? e.message : e}`);
    }
    this.child = child;
    const timer = setTimeout(() => child.kill('SIGTERM'), TURN_MS);
    let buf = '', errText = '';
    child.stdout!.on('data', (d: Buffer) => {
      buf += d.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.event(line, said);
      }
    });
    child.stderr!.on('data', (d: Buffer) => (errText = (errText + d.toString('utf8')).slice(-2000)));
    child.on('error', (e) => (errText = e.message));
    child.on('close', (code) => {
      clearTimeout(timer);
      this.child = undefined;
      const failed = !said.length ? (code === null ? 'It took too long and was stopped.' : errText.trim().split('\n').pop() || `Codex stopped (${code}).`) : undefined;
      // A thread Codex can't find any more starts over next time.
      if (failed && this.saved.thread && /no (?:rollout|session|thread)|not found/i.test(errText)) delete this.saved.thread;
      this.finish(said, failed);
    });
    child.stdin!.end(prompt);
  }

  private event(line: string, said: string[]) {
    let e: { type?: string; thread_id?: string; item?: { type?: string; text?: string; command?: string }; usage?: Record<string, number>; error?: { message?: string }; message?: string };
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    if (e.type === 'thread.started' && e.thread_id) {
      this.saved.thread = e.thread_id;
      this.save();
    } else if (e.type === 'item.started' && e.item?.type === 'command_execution' && e.item.command) {
      this.doing = [...this.doing, stepOf(e.item.command)].slice(-12);
      // What it said before looking ("I'll check\u2026") isn't the answer: the answer comes after its last command.
      said.length = 0;
    } else if (e.type === 'item.completed' && e.item?.type === 'agent_message' && e.item.text?.trim()) {
      said.push(e.item.text.trim());
    } else if (e.type === 'turn.completed' && e.usage) {
      const u = this.saved.used;
      u.input += e.usage.input_tokens ?? 0;
      u.cached += e.usage.cached_input_tokens ?? 0;
      u.output += (e.usage.output_tokens ?? 0) + (e.usage.reasoning_output_tokens ?? 0);
      u.turns += 1;
    } else if ((e.type === 'turn.failed' || e.type === 'error') && (e.error?.message || e.message)) {
      this.error = e.error?.message ?? e.message;
    }
  }

  private finish(said: string[], failed: string | undefined) {
    const steps = this.doing;
    if (said.length) this.saved.messages.push({ id: `a${Date.now().toString(36)}${randomBytes(3).toString('hex')}`, role: 'assistant', text: said.join('\n\n'), at: Date.now(), ...(steps.length ? { steps } : {}) });
    else this.error = failed ?? this.error ?? 'No answer came back.';
    this.doing = [];
    this.save();
    this.pump();
  }
}
