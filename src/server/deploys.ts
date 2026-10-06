import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Deploy } from '../shared/table-info.js';
import { gh } from './github.js';

// Where a table's project is deployed (its panel and its screen, server/table-info.ts and room-screens.ts): the
// live site and each branch's preview, from Vercel when the office is signed in to it, and from GitHub's
// deployments otherwise (what Vercel, Netlify and the like record there when they're connected to the
// repository). Vercel's sign-in is a token an admin gives the office (the table's panel), kept in
// <dataDir>/vercel.json (0600): it only ever goes to Vercel, and nobody's browser sees it again. Each
// repository is asked at most once a minute.

const EVERY_MS = 60_000;
const API = 'https://api.vercel.com';
const STATES: Record<string, Deploy['state']> = {
  READY: 'ready',
  BUILDING: 'building',
  INITIALIZING: 'building',
  QUEUED: 'building',
  ERROR: 'error',
  CANCELED: 'canceled',
  success: 'ready',
  in_progress: 'building',
  queued: 'building',
  pending: 'building',
  failure: 'error',
  error: 'error',
  inactive: 'canceled',
};

/** A Vercel project, as much of it as the office uses. */
interface Project {
  id: string;
  name: string;
  team?: string;
  repo?: string;
  /** Its live address (its production domain). */
  live?: string;
  /** Its secret for automation to get past Vercel's login on previews, if it has one. */
  bypass?: string;
}

/** What a repository's deployments came to. */
export interface Deployed {
  list: Deploy[];
  live?: string;
  /** The Vercel project they're from. */
  project?: string;
  error?: string;
}

type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class Deploys {
  private kept = new Map<string, { at: number; going?: Promise<void>; got: Deployed }>();
  private projects?: { at: number; list: Project[] };
  /** The protection bypass secrets of the previews it knows, by host: for the screens' browser only. */
  private bypasses = new Map<string, string>();

  constructor(
    private dataDir: string,
    private fetchImpl: Fetch = (url, init) => fetch(url, init),
    private ghImpl: (args: string[], cwd: string) => Promise<string> = gh,
  ) {}

  private get file() {
    return path.join(this.dataDir, 'vercel.json');
  }

  private saved(): { token?: string; user?: string } {
    try {
      return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as { token?: string; user?: string }) : {};
    } catch {
      return {};
    }
  }

  /** Whether the office is signed in to Vercel, and who as. */
  status(): { connected: boolean; user?: string } {
    const s = this.saved();
    return { connected: !!s.token, ...(s.user ? { user: s.user } : {}) };
  }

  private async api(token: string, url: string): Promise<Record<string, any>> {
    const res = await this.fetchImpl(`${API}${url}`, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 401 || res.status === 403) throw new Error('Vercel turned the office’s token down: sign in again with a new one');
    if (!res.ok) throw new Error(`Vercel answered ${res.status}`);
    return (await res.json()) as Record<string, any>;
  }

  /** Signs the office in to Vercel with `token`, checking it first: who it is, or why not. An empty token signs it out. */
  async connect(token: string): Promise<{ user: string } | string | undefined> {
    const t = token.trim();
    if (!t) {
      rmSync(this.file, { force: true });
      this.reset();
      return undefined;
    }
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(t)) return 'That doesn’t look like a Vercel token';
    let user: string;
    try {
      const me = await this.api(t, '/v2/user');
      user = String(me.user?.username ?? me.user?.name ?? me.user?.email ?? 'Vercel');
    } catch (e) {
      const why = (e as Error).message;
      return /turned the office/.test(why) ? 'Vercel turned that token down: check it, or make a new one' : why;
    }
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ token: t, user }), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
    this.reset();
    return { user };
  }

  private reset() {
    this.kept.clear();
    this.projects = undefined;
    this.bypasses.clear();
  }

  /** Every Vercel project the token reaches, its own and its teams'; kept ten minutes. */
  async list(): Promise<Project[]> {
    const token = this.saved().token;
    if (!token) return [];
    if (this.projects && Date.now() - this.projects.at < 10 * EVERY_MS) return this.projects.list;
    const teams = ((await this.api(token, '/v2/teams').catch(() => ({ teams: [] }))).teams ?? []) as { id: string }[];
    const out: Project[] = [];
    for (const team of [undefined, ...teams.map((t) => t.id)]) {
      const got = await this.api(token, `/v9/projects?limit=100${team ? `&teamId=${encodeURIComponent(team)}` : ''}`).catch(() => ({ projects: [] }));
      for (const p of (got.projects ?? []) as Record<string, any>[]) {
        const domain = p.targets?.production?.alias?.[0] ?? (p.alias as { domain?: string; target?: string }[] | undefined)?.find((a) => a.target === 'PRODUCTION' || !a.target)?.domain;
        const bypass = Object.entries((p.protectionBypass ?? {}) as Record<string, { scope?: string }>).find(([, v]) => v?.scope === 'automation-bypass')?.[0];
        out.push({
          id: String(p.id),
          name: String(p.name),
          ...(team ? { team } : {}),
          ...(p.link?.org && p.link?.repo ? { repo: `${p.link.org}/${p.link.repo}` } : {}),
          ...(domain ? { live: `https://${domain}` } : p.targets?.production?.url ? { live: `https://${p.targets.production.url}` } : {}),
          ...(bypass ? { bypass } : {}),
        });
      }
    }
    this.projects = { at: Date.now(), list: out };
    return out;
  }

  /** The Vercel project for a table: the one it was set to, else the one linked to its repository, else the one named like it. */
  private async projectFor(repo: string | undefined, named: string | undefined): Promise<Project | undefined> {
    const list = await this.list();
    const lower = (s?: string) => s?.toLowerCase();
    return (named ? list.find((p) => lower(p.name) === lower(named)) : undefined) ?? list.find((p) => repo && lower(p.repo) === lower(repo)) ?? list.find((p) => repo && lower(p.name) === lower(repo.split('/')[1]));
  }

  private async fromVercel(repo: string | undefined, named: string | undefined): Promise<Deployed | undefined> {
    const token = this.saved().token;
    if (!token) return undefined;
    const project = await this.projectFor(repo, named);
    if (!project) return { list: [], error: named ? `No Vercel project called ${named}` : 'No Vercel project for this repository: pick one in the panel' };
    const got = await this.api(token, `/v6/deployments?projectId=${encodeURIComponent(project.id)}&limit=40${project.team ? `&teamId=${encodeURIComponent(project.team)}` : ''}`);
    const list: Deploy[] = ((got.deployments ?? []) as Record<string, any>[]).flatMap((d) => {
      if (!d.url) return [];
      const branch = d.meta?.githubCommitRef ?? d.meta?.gitlabCommitRef ?? d.meta?.bitbucketCommitRef;
      const sha = d.meta?.githubCommitSha ?? d.meta?.gitlabCommitSha ?? d.meta?.bitbucketCommitSha;
      return [{
        env: d.target === 'production' ? ('production' as const) : ('preview' as const),
        ...(typeof branch === 'string' && branch ? { branch } : {}),
        ...(typeof sha === 'string' && sha ? { sha } : {}),
        url: `https://${d.url}`,
        state: STATES[String(d.state ?? d.readyState)] ?? 'building',
        at: Number(d.created ?? d.createdAt ?? 0),
        from: 'vercel' as const,
        ...(typeof d.inspectorUrl === 'string' ? { inspect: d.inspectorUrl } : {}),
      }];
    });
    if (project.bypass) for (const d of list) this.bypasses.set(new URL(d.url).host, project.bypass);
    const live = project.live ?? list.find((d) => d.env === 'production' && d.state === 'ready')?.url;
    return { list, ...(live ? { live } : {}), project: project.name };
  }

  private async fromGitHub(repo: string, cwd: string): Promise<Deployed> {
    const all = JSON.parse(await this.ghImpl(['api', `repos/${repo}/deployments?per_page=40`], cwd)) as Record<string, any>[];
    // The newest of each environment and branch: their statuses say where each is, and how it went.
    const newest = new Map<string, Record<string, any>>();
    for (const d of all) {
      const key = `${d.environment}|${d.ref}`;
      if (!newest.has(key)) newest.set(key, d);
    }
    const list: Deploy[] = [];
    for (const d of [...newest.values()].slice(0, 12)) {
      const statuses = JSON.parse(await this.ghImpl(['api', `repos/${repo}/deployments/${Number(d.id)}/statuses?per_page=1`], cwd).catch(() => '[]')) as Record<string, any>[];
      const s = statuses[0];
      const url = s?.environment_url || s?.target_url;
      if (!s || typeof url !== 'string' || !/^https?:\/\//.test(url)) continue;
      const ref = String(d.ref ?? '');
      list.push({
        env: /prod/i.test(String(d.environment)) ? 'production' : 'preview',
        ...(ref && !/^[0-9a-f]{40}$/.test(ref) ? { branch: ref } : {}),
        ...(typeof d.sha === 'string' ? { sha: d.sha } : {}),
        url,
        state: STATES[String(s.state)] ?? 'building',
        at: Date.parse(String(s.created_at ?? d.created_at)) || 0,
        from: 'github',
        ...(typeof s.log_url === 'string' ? { inspect: s.log_url } : {}),
      });
    }
    const live = list.find((d) => d.env === 'production' && d.state === 'ready')?.url;
    return { list, ...(live ? { live } : {}) };
  }

  /**
   * A table's deployments, as last asked (asking again when that's a minute old): from Vercel when the
   * office is signed in to it (the project `named`, else the repository's), else from GitHub. The first
   * time, it waits for the answer.
   */
  async of(repo: string | undefined, named: string | undefined, cwd: string): Promise<Deployed> {
    const key = `${repo ?? ''}|${named ?? ''}`;
    let k = this.kept.get(key);
    if (!k) this.kept.set(key, (k = { at: 0, got: { list: [] } }));
    if (!k.going && Date.now() - k.at > EVERY_MS) {
      const entry = k;
      entry.going = (async () => {
        try {
          entry.got = (await this.fromVercel(repo, named)) ?? (repo ? await this.fromGitHub(repo, cwd) : { list: [] });
        } catch (e) {
          entry.got = { ...entry.got, error: (e as Error).message };
        }
      })().finally(() => {
        entry.at = Date.now();
        entry.going = undefined;
      });
    }
    if (!k.at && k.going) await k.going;
    return k.got;
  }

  /** The names of the Vercel projects the office can pick from, for an admin setting a table's. */
  async names(): Promise<string[]> {
    return (await this.list().catch(() => [])).map((p) => p.name).sort();
  }

  /** The header that gets the screens' browser past Vercel's login on a preview at `url`, if its project has one. */
  headersFor(url: string): Record<string, string> {
    try {
      const secret = this.bypasses.get(new URL(url).host);
      return secret ? { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' } : {};
    } catch {
      return {};
    }
  }
}

const instances = new Map<string, Deploys>();
/** The office's deployments reader (one a data folder). */
export function deploysOf(dataDir: string): Deploys {
  let d = instances.get(dataDir);
  if (!d) instances.set(dataDir, (d = new Deploys(dataDir)));
  return d;
}

/** The newest ready deployment of each branch, and the live one: what's worth showing. */
export function newestByBranch(list: readonly Deploy[]): Map<string, Deploy> {
  const out = new Map<string, Deploy>();
  for (const d of [...list].sort((a, b) => b.at - a.at)) {
    if (d.env !== 'preview' || !d.branch || out.has(d.branch)) continue;
    out.set(d.branch, d);
  }
  return out;
}
