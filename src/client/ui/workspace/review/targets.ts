import { store } from '../../../state';
import { serviceUrl } from '../../services';

// What a worker has to review in Software review, and where this browser reaches it.

/** Something of the worker's to review: one of its servers by port, or its project room's app elsewhere. */
export interface ReviewTarget {
  key: string;
  label: string;
  port?: number;
  /** An address outside the office (a deployed preview): shown as it is, without comments. */
  direct?: string;
}

const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?(\/.*)?$/i;

/** What a worker has to review: the servers it started, and its project room's app when that's somewhere else. */
export function reviewTargets(workerId: string): ReviewTarget[] {
  const out: ReviewTarget[] = store.services.items
    .filter((s) => s.workerId === workerId)
    .sort((a, b) => a.port - b.port)
    .map((s) => ({ key: `port:${s.port}`, label: `${s.title || s.command} · port ${s.port}`, port: s.port }));
  const project = store.workers.get(workerId)?.project;
  if (project?.url) {
    const local = LOCAL.exec(project.url);
    const port = local ? Number(local[1] || 80) : undefined;
    if (port && !out.some((t) => t.port === port)) out.push({ key: `port:${port}`, label: `${project.name ?? 'Project'} app · port ${port}`, port });
    else if (!local) out.push({ key: `url:${project.url}`, label: `${project.name ?? 'Project'} app`, direct: project.url });
  }
  return out;
}

/** The app's address as the worker knows it: what a comment and a round are kept against. */
export const appAddress = (t: ReviewTarget) => (t.port ? `http://localhost:${t.port}` : (t.direct ?? ''));

/**
 * Where a worker's server is reached through the office's relay in review mode from this browser: on
 * the tailnet by its port, or on the office's own machine at p<port>.localhost. Nowhere else, since the
 * relay takes comments only for an office at one of those addresses (server/review/relay.ts).
 */
export function relayBase(port: number): string | undefined {
  const { tailnet } = store.services;
  if (tailnet && location.hostname === tailnet) return `https://${tailnet}:${port}`;
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return `${location.protocol}//p${port}.localhost:${location.port || (location.protocol === 'https:' ? 443 : 80)}`;
  return undefined;
}

/** Where to open it with no comments: through the service tunnel, or the address it's at. */
export const plainUrl = (t: ReviewTarget, path: string) => t.direct ?? `${serviceUrl(t.port!)}${path}`;
