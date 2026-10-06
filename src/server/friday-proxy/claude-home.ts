// The Claude Code config folder for workers that run through Friday Proxy.
//
// Claude Code reads a claude.ai login (the keychain's, per config folder) ahead of ANTHROPIC_AUTH_TOKEN,
// so pointed at the proxy from the person's own ~/.claude it still sends their login, which the proxy
// turns down. In a folder of its own, with no login, it sends the proxy's key. Everything else of theirs
// is linked in (skills, agents, commands, plugins, settings, CLAUDE.md), its first-run questions are
// answered, and the folders their own Claude trusts are trusted here too, as signins.ts does for accounts.
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** What's linked in from the person's own Claude folder: never its login or its sessions. */
const SHARED = ['settings.json', 'CLAUDE.md', 'skills', 'agents', 'commands', 'plugins', 'output-styles'];

/** The person's own Claude folder and the settings file beside it, where Claude Code keeps them. */
export function ownClaude(env: NodeJS.ProcessEnv = process.env): { dir: string; json: string } {
  const dir = env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude');
  return { dir, json: env.CLAUDE_CONFIG_DIR ? path.join(dir, '.claude.json') : path.join(homedir(), '.claude.json') };
}

/** Whether `dir`, or a folder it's in, is one the person's Claude trusts. */
function trusted(projects: Record<string, { hasTrustDialogAccepted?: boolean }> | undefined, dir: string): boolean {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (projects?.[d]?.hasTrustDialogAccepted === true) return true;
    if (path.dirname(d) === d) return false;
  }
}

/**
 * Makes `home` ready for a routed Claude worker starting in `cwd`: links, first run done, folder trust
 * carried over. Quietly does what it can: a worker that has to answer a question is better than none.
 */
export function prepareClaudeHome(home: string, cwd: string, own = ownClaude()) {
  try {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    for (const name of SHARED) {
      const from = path.join(own.dir, name);
      const to = path.join(home, name);
      if (!existsSync(from)) continue;
      try {
        lstatSync(to);
      } catch {
        symlinkSync(from, to);
      }
    }
    const file = path.join(home, '.claude.json');
    let c: any = {};
    try {
      c = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // new
    }
    const before = JSON.stringify(c);
    c.hasCompletedOnboarding = true;
    let mine: any;
    try {
      mine = JSON.parse(readFileSync(own.json, 'utf8'));
    } catch {
      // no Claude of their own yet
    }
    if (trusted(mine?.projects, cwd)) {
      c.projects ??= {};
      c.projects[cwd] = { ...c.projects[cwd], hasTrustDialogAccepted: true };
    }
    if (JSON.stringify(c) !== before) writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error(`agent-office: couldn't prepare Friday Proxy's Claude folder ${home}: ${(err as Error).message}`);
  }
}
