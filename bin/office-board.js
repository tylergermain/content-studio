#!/usr/bin/env node
// office-board: a floor's own bulletin boards from inside the office (see src/shared/studio.ts), for
// any worker on the floor. The office puts it on their PATH and gives them their own address and
// token in AGENT_OFFICE_HOOK_URL, AGENT_OFFICE_WORKER_ID and AGENT_OFFICE_HOOK_TOKEN; this talks to
// the /office/board endpoint with them. Plain Node, no build step, no dependencies.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage:
  office-board list [--board "Title"]                  the floor's boards and what's posted on them
  office-board post --title "…" [--board "Title"]      put a post up; a few lines about it on stdin
       [--url https://…] [--source "Publisher"] <<'EOF'    (or --body "…"). Prints the post's id.
  …what it's about…                                    With one board on the floor, --board can be left out.
  EOF
  office-board remove <id>                             take a post down`;

/** A mistake in how the command was called: the usage is shown with it. */
export class UsageError extends Error {}

const ENV = ['AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_HOOK_TOKEN'];
/** How long the office may take to come back when it's restarting (a dev reload, an upgrade). */
const RETRY_MS = 6000;
const TIMEOUT_MS = 15_000;
const FLAGS = ['--board', '--title', '--url', '--source', '--body'];

/**
 * What the command line asks for:
 * { cmd: 'help' } | { cmd: 'list', board? } | { cmd: 'post', title, board?, url?, source?, body? } | { cmd: 'remove', id }.
 * @param {string[]} argv the arguments after the command's name
 */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const help = (a) => a === '-h' || a === '--help';
  if (cmd === undefined || cmd === 'help' || help(cmd) || help(rest[0])) return { cmd: 'help' };
  if (cmd === 'remove' || cmd === 'rm') {
    if (rest.length !== 1 || rest[0].startsWith('-')) throw new UsageError('remove takes one post id, e.g. office-board remove 3f9c2a1b');
    return { cmd: 'remove', id: rest[0] };
  }
  if (cmd !== 'list' && cmd !== 'ls' && cmd !== 'post' && cmd !== 'add') throw new UsageError(`Unknown command: ${cmd}`);
  const list = cmd === 'list' || cmd === 'ls';
  /** @type {Record<string, string>} */
  const got = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    if (!FLAGS.includes(flag) || (list && flag !== '--board')) {
      throw new UsageError(arg.startsWith('-') ? `Unknown option for ${list ? 'list' : 'post'}: ${flag}` : `Unexpected argument: ${arg} (quote the title, and give the rest on stdin or with --body)`);
    }
    let value;
    if (flag !== arg) value = arg.slice(eq + 1);
    else if (i + 1 < rest.length) value = rest[++i];
    else throw new UsageError(`${flag} needs a value`);
    got[flag.slice(2)] = flag === '--body' ? value : value.trim();
  }
  if (list) return { cmd: 'list', ...(got.board ? { board: got.board } : {}) };
  if (!got.title) throw new UsageError('Give the post a --title, e.g. office-board post --title "OpenAI ships a new model"');
  return { cmd: 'post', ...got };
}

/**
 * The office's address and this worker's name and token, from the environment.
 * @param {Record<string, string | undefined>} env
 */
export function officeEnv(env) {
  const missing = ENV.filter((k) => !env[k]);
  if (missing.length) throw new Error(`${missing.join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} set. office-board only works inside the office, from a worker's terminal.`);
  return { url: env.AGENT_OFFICE_HOOK_URL.replace(/\/+$/, ''), worker: env.AGENT_OFFICE_WORKER_ID, token: env.AGENT_OFFICE_HOOK_TOKEN };
}

/**
 * The HTTP request for a parsed command (anything but help). `body` is what came in on stdin, for a
 * post that didn't give --body.
 * @param {ReturnType<typeof parseArgs>} cmd
 * @param {{ url: string, worker: string, token: string }} office
 * @param {string} [body]
 */
export function buildRequest(cmd, office, body) {
  const url = new URL(`${office.url}/office/board`);
  url.searchParams.set('worker', office.worker);
  const headers = { authorization: `Bearer ${office.token}` };
  if (cmd.cmd === 'list') {
    if (cmd.board) url.searchParams.set('board', cmd.board);
    return { method: 'GET', url: url.href, headers };
  }
  if (cmd.cmd === 'remove') {
    url.searchParams.set('post', cmd.id);
    return { method: 'DELETE', url: url.href, headers };
  }
  if (cmd.cmd !== 'post') throw new Error(`No request for ${cmd.cmd}`);
  const text = (cmd.body ?? body ?? '').replace(/\r\n?/g, '\n').trim();
  const post = { title: cmd.title, ...(cmd.board ? { board: cmd.board } : {}), ...(cmd.url ? { url: cmd.url } : {}), ...(cmd.source ? { source: cmd.source } : {}), ...(text ? { body: text } : {}) };
  return { method: 'POST', url: url.href, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(post) };
}

/**
 * The floor's boards as the office returns them: each board, then its posts, newest first.
 * @param {{ boards?: Array<{ title: string, about?: string, filled?: boolean, posts?: Array<Record<string, any>> }> }} view
 */
export function formatBoards(view) {
  const boards = view?.boards ?? [];
  if (!boards.length) return 'This floor has no bulletin boards.';
  const lines = [];
  for (const b of boards) {
    lines.push(`${b.title}${b.about ? `: ${b.about}` : ''}${b.filled ? ' (the office fills this one itself)' : ''}`);
    for (const p of b.posts ?? []) lines.push(`  ${p.id}  ${p.title}${p.source ? ` · ${p.source}` : ''}${p.url ? ` · ${p.url}` : ''} · by ${p.by}`);
    if (!(b.posts ?? []).length) lines.push('  (nothing posted)');
  }
  return lines.join('\n');
}

/** Sends the request, retrying for a few seconds while nothing's listening (the office restarting). */
async function send(req, fetchImpl) {
  const until = Date.now() + RETRY_MS;
  for (;;) {
    try {
      const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await res.text();
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { error: text.slice(0, 300) };
      }
      return { status: res.status, body };
    } catch (err) {
      const code = err?.cause?.code ?? err?.code;
      if (code === 'ECONNREFUSED' && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw new Error(`Couldn't reach the office at ${new URL(req.url).origin} (${code ?? err?.message ?? err}). Is it running?`);
    }
  }
}

function readStdin(stdin) {
  return new Promise((resolve, reject) => {
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (c) => (data += c));
    stdin.on('end', () => resolve(data));
    stdin.on('error', reject);
  });
}

/**
 * Runs the command; resolves to its exit code.
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, stdin?: NodeJS.ReadableStream & { isTTY?: boolean }, fetch?: typeof fetch, out?: (s: string) => void, err?: (s: string) => void }} [io]
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const stdin = io.stdin ?? process.stdin;
  const fetchImpl = io.fetch ?? fetch;
  const out = io.out ?? ((s) => process.stdout.write(s + '\n'));
  const err = io.err ?? ((s) => process.stderr.write(s + '\n'));
  try {
    const cmd = parseArgs(argv);
    if (cmd.cmd === 'help') {
      out(USAGE);
      return 0;
    }
    const office = officeEnv(env);
    // What it's about is optional: only read stdin when something's piped in.
    const body = cmd.cmd === 'post' && cmd.body === undefined && !stdin.isTTY ? await readStdin(stdin) : undefined;
    const res = await send(buildRequest(cmd, office, body), fetchImpl);
    if (res.status < 200 || res.status >= 300) {
      err(`office-board: the office said no (${res.status})${res.body?.error ? `: ${res.body.error}` : ''}.`);
      return 1;
    }
    if (cmd.cmd === 'list') out(formatBoards(res.body));
    else if (cmd.cmd === 'remove') out(`Took ${cmd.id} down.`);
    else {
      out(res.body?.post?.id ?? '');
      err(`Posted “${res.body?.post?.title ?? cmd.title}” to ${res.body?.board ?? 'the board'}.`);
    }
    return 0;
  } catch (e) {
    err(`office-board: ${e.message}`);
    if (e instanceof UsageError) err(`\n${USAGE}`);
    return e instanceof UsageError ? 2 : 1;
  }
}

const invoked = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invoked) process.exitCode = await main(process.argv.slice(2));
