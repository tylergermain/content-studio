import { execFile } from 'node:child_process';

// Reading a checkout with git for what the office shows of it (a table's panel, its screen): never taking git's locks
// from whoever's working there, never stopping to ask for a password, and with git's own complaint as the error.

export function git(args: string[], cwd: string, timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } }, (err, out, stderr) => {
      if (!err) return resolve(out);
      const lines = String(stderr || err.message).trim().split('\n');
      reject(new Error((lines.find((l) => /^(fatal|error):/.test(l)) ?? lines[0]).replace(/^(fatal|error):\s*/, '')));
    });
  });
}

/**
 * The branch the checkout `dir` is on; one that isn't on any (an agent told to run a branch without taking it over),
 * by the branch whose tip it's at, else its commit. Undefined when git can't say.
 */
export async function branchAt(dir: string): Promise<string | undefined> {
  const on = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).catch(() => '')).trim();
  if (on && on !== 'HEAD') return on;
  if (!on) return undefined;
  const tips = (await git(['for-each-ref', '--points-at', 'HEAD', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin'], dir).catch(() => ''))
    .split('\n')
    .filter((r) => r && r !== 'refs/remotes/origin/HEAD')
    .map((r) => r.replace(/^refs\/heads\/|^refs\/remotes\/origin\//, ''));
  return tips[0] ?? ((await git(['rev-parse', '--short', 'HEAD'], dir).catch(() => '')).trim() || undefined);
}
