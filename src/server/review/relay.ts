import http from 'node:http';
import { REVIEW_SCRIPT, REVIEW_START } from '../../shared/software-review.js';
import type { ServiceInfo } from '../../shared/protocol.js';
import { parseCookies } from '../auth.js';
import { upstreamHeaders } from '../relay.js';
import { OVERLAY_JS, injectOverlay } from './overlay.js';

// Review mode on a worker's server (see shared/software-review.ts). The office's Review app frames the
// worker's app through the relay (relay.ts), starting at REVIEW_START, which notes the office's origin
// in a cookie on the worker's server and goes on to the page. From then on, a page framed there (and
// only framed: a page opened in a tab of its own is left alone) comes with the review script added
// (overlay.ts), and without the headers that would stop the office framing it.

export const REVIEW_COOKIE = 'agent-office-review';
/** The biggest page the review script is added to: anything bigger goes through as it is. */
const MAX_PAGE = 10 * 1024 * 1024;

/** Whether `origin` is the office's own, as the browser sees it (its machine, or its name on the tailnet): the only one the script answers. */
export function officeOriginOk(origin: string, tailnet: string | undefined): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === origin && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || (!!tailnet && u.hostname === tailnet));
  } catch {
    return false;
  }
}

/** Answers REVIEW_START and REVIEW_SCRIPT on a worker's server: true when it did. */
export function reviewRoute(req: http.IncomingMessage, res: http.ServerResponse, tailnet: string | undefined): boolean {
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://x');
  } catch {
    return false;
  }
  if (url.pathname === REVIEW_SCRIPT) {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(OVERLAY_JS);
    return true;
  }
  if (url.pathname !== REVIEW_START) return false;
  const office = url.searchParams.get('office') ?? '';
  const next = url.searchParams.get('next') ?? '/';
  if (!officeOriginOk(office, tailnet) || !next.startsWith('/') || next.startsWith('//')) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not a review the office started');
    return true;
  }
  const secure = req.headers['x-forwarded-proto'] === 'https' || office.startsWith('https:');
  res.writeHead(302, {
    location: next,
    'set-cookie': `${REVIEW_COOKIE}=${encodeURIComponent(office)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    'cache-control': 'no-store',
  });
  res.end();
  return true;
}

/** The office origin to add the review script for, when this is a framed page in review mode; else nothing. */
export function reviewOffice(req: http.IncomingMessage, tailnet: string | undefined): string | undefined {
  if (req.method !== 'GET' || req.headers['sec-fetch-dest'] !== 'iframe') return undefined;
  const raw = parseCookies(req.headers.cookie)[REVIEW_COOKIE];
  let office = '';
  try {
    office = raw ? decodeURIComponent(raw) : '';
  } catch {
    return undefined;
  }
  return officeOriginOk(office, tailnet) ? office : undefined;
}

/** Relays a framed page in review mode: the review script added to it, and nothing to stop the office framing it. */
export function relayReviewed(req: http.IncomingMessage, res: http.ServerResponse, svc: ServiceInfo, office: string) {
  const headers = { ...upstreamHeaders(req, svc), 'accept-encoding': 'identity' };
  const up = http.request({ host: svc.host, port: svc.port, method: req.method, path: req.url, headers }, (ur) => {
    const out: http.OutgoingHttpHeaders = { ...ur.headers };
    for (const h of ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only']) delete out[h];
    const html = /text\/html/i.test(String(ur.headers['content-type'] ?? ''));
    const plain = !ur.headers['content-encoding'] || ur.headers['content-encoding'] === 'identity';
    const length = Number(ur.headers['content-length'] ?? 0);
    if (!html || !plain || length > MAX_PAGE) {
      res.writeHead(ur.statusCode ?? 502, ur.statusMessage, out);
      ur.pipe(res);
      return;
    }
    const chunks: Buffer[] = [];
    ur.on('data', (c: Buffer) => chunks.push(c));
    ur.on('end', () => {
      if (res.headersSent) return;
      const page = injectOverlay(Buffer.concat(chunks).toString('utf8'), office);
      delete out['content-length'];
      delete out.etag;
      out['cache-control'] = 'no-store';
      res.writeHead(ur.statusCode ?? 502, ur.statusMessage, out);
      res.end(page);
    });
    ur.on('error', () => res.destroy());
  });
  up.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`The server on port ${svc.port} didn't answer. It may be restarting: try again in a moment.`);
    } else res.destroy();
  });
  res.on('close', () => up.destroy());
  req.pipe(up);
}
