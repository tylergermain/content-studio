import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tunneledPort, upstreamHeaders } from '../src/server/relay.js';
import { injectOverlay, OVERLAY_JS } from '../src/server/review/overlay.js';
import { REVIEW_COOKIE, officeOriginOk, relayReviewed, reviewOffice, reviewRoute } from '../src/server/review/relay.js';
import { REVIEW_SCRIPT, REVIEW_START, cleanSoftwareNotes, softwareReviewText } from '../src/shared/software-review.js';
import type { ServiceInfo } from '../src/shared/protocol.js';

// Software review (shared/software-review.ts): a worker's running app framed in the office through
// the relay, with the review script added to its pages, and the comments sent back as one request.

const TAILNET = 'office.tail1234.ts.net';
const req = (url: string, headers: Record<string, string> = {}, method = 'GET') => ({ url, headers, method }) as unknown as http.IncomingMessage;
function res() {
  const out: { status?: number; headers?: Record<string, unknown>; body?: string } = {};
  const r = {
    writeHead(status: number, headers: Record<string, unknown>) {
      out.status = status;
      out.headers = headers;
      return r;
    },
    end(body?: string) {
      out.body = body;
    },
  };
  return { r: r as unknown as http.ServerResponse, out };
}

test('the review script goes first in the page, and knows the office it answers', () => {
  assert.equal(injectOverlay('<html><head><title>x</title></head><body></body></html>', 'https://o.ts.net:11443'), `<html><head><script src="${REVIEW_SCRIPT}" data-office="https://o.ts.net:11443" defer></script><title>x</title></head><body></body></html>`);
  assert.ok(injectOverlay('<!doctype html><html lang="en"><body>hi</body></html>', 'http://localhost:4600').includes('<html lang="en"><script src='));
  assert.ok(injectOverlay('<p>bare</p>', 'http://localhost:4600').startsWith('<script src='));
  assert.ok(!injectOverlay('<head>', 'http://x"><script>alert(1)</script>').includes('"><script>alert'));
  // It answers only a page framed by the office, and only messages from it.
  assert.ok(OVERLAY_JS.includes("window.parent === window") && OVERLAY_JS.includes('e.origin !== office'));
});

test("the review answers only the office's own origin: its machine or its name on the tailnet", () => {
  assert.ok(officeOriginOk('http://localhost:4600', TAILNET));
  assert.ok(officeOriginOk(`https://${TAILNET}:11443`, TAILNET));
  assert.ok(officeOriginOk('http://127.0.0.1:4600', undefined));
  assert.ok(!officeOriginOk('https://evil.example', TAILNET));
  assert.ok(!officeOriginOk(`https://${TAILNET}.evil.example`, TAILNET));
  assert.ok(!officeOriginOk('http://localhost:4600/path', TAILNET), 'an origin, not a page');
  assert.ok(!officeOriginOk('javascript:alert(1)', TAILNET));
});

test('starting a review notes the office in a cookie and goes on to the page; the script is served too', () => {
  const ok = res();
  assert.ok(reviewRoute(req(`${REVIEW_START}?office=${encodeURIComponent(`https://${TAILNET}:11443`)}&next=%2Fpricing%3Fa%3D1`), ok.r, TAILNET));
  assert.equal(ok.out.status, 302);
  assert.equal(ok.out.headers?.location, '/pricing?a=1');
  assert.match(String(ok.out.headers?.['set-cookie']), new RegExp(`^${REVIEW_COOKIE}=https%3A%2F%2F${TAILNET.replace(/\./g, '\\.')}%3A11443; Path=/; HttpOnly; SameSite=Lax; Secure$`));
  for (const bad of [`${REVIEW_START}?office=https%3A%2F%2Fevil.example&next=%2F`, `${REVIEW_START}?office=http%3A%2F%2Flocalhost%3A4600&next=%2F%2Fevil.example`]) {
    const no = res();
    assert.ok(reviewRoute(req(bad), no.r, TAILNET));
    assert.equal(no.out.status, 400, bad);
  }
  const js = res();
  assert.ok(reviewRoute(req(REVIEW_SCRIPT), js.r, TAILNET));
  assert.equal(js.out.body, OVERLAY_JS);
  assert.ok(!reviewRoute(req('/pricing'), res().r, TAILNET), 'the app\u2019s own pages are the app\u2019s');
});

test('only a page framed in review mode gets the script', () => {
  const cookie = `${REVIEW_COOKIE}=${encodeURIComponent('http://localhost:4600')}; other=1`;
  assert.equal(reviewOffice(req('/', { cookie, 'sec-fetch-dest': 'iframe' }), TAILNET), 'http://localhost:4600');
  assert.equal(reviewOffice(req('/', { cookie, 'sec-fetch-dest': 'document' }), TAILNET), undefined, 'a tab of its own');
  assert.equal(reviewOffice(req('/', { 'sec-fetch-dest': 'iframe' }), TAILNET), undefined, 'not in review mode');
  assert.equal(reviewOffice(req('/', { cookie: `${REVIEW_COOKIE}=https%3A%2F%2Fevil.example`, 'sec-fetch-dest': 'iframe' }), TAILNET), undefined);
  assert.equal(reviewOffice(req('/', { cookie, 'sec-fetch-dest': 'iframe' }, 'POST'), TAILNET), undefined);
  // Neither the office's cookies nor the review's go on to the worker's server.
  const up = upstreamHeaders(req('/', { cookie: `${REVIEW_COOKIE}=x; app=1`, host: 'localhost:5173' }), { port: 5173, host: '127.0.0.1' } as ServiceInfo);
  assert.equal(up.cookie, 'app=1');
});

test("a worker's server is reached through the office's own port at p<port>.localhost on the office's machine", () => {
  assert.equal(tunneledPort(req('/', { host: 'p5173.localhost:4600' }), 4600), 5173);
  assert.equal(tunneledPort(req('/', { host: 'p5173.localhost:9999' }), 4600), 9999, 'another port is still that port, as before');
  assert.equal(tunneledPort(req('/', { host: 'p4600.localhost:4600' }), 4600), undefined);
  assert.equal(tunneledPort(req('/', { host: 'localhost:4600' }), 4600), undefined);
});

test('a page relayed in review mode comes with the script and without what stops framing; anything else is untouched', async (t) => {
  const app = http.createServer((q, s) => {
    if (q.url === '/style.css') {
      s.writeHead(200, { 'content-type': 'text/css', 'x-frame-options': 'DENY' });
      return s.end('body{}');
    }
    s.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'", etag: 'abc' });
    s.end('<html><head></head><body>hi from app</body></html>');
  });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  const svc = { port: (app.address() as AddressInfo).port, host: '127.0.0.1' } as ServiceInfo;
  const front = http.createServer((q, s) => relayReviewed(q, s, svc, 'http://localhost:4600'));
  await new Promise<void>((r) => front.listen(0, '127.0.0.1', r));
  t.after(() => {
    app.close();
    front.close();
  });
  const base = `http://127.0.0.1:${(front.address() as AddressInfo).port}`;
  const page = await fetch(`${base}/`);
  const html = await page.text();
  assert.ok(html.includes(`<head><script src="${REVIEW_SCRIPT}" data-office="http://localhost:4600" defer></script></head>`), html);
  assert.ok(html.includes('hi from app'));
  assert.equal(page.headers.get('x-frame-options'), null);
  assert.equal(page.headers.get('content-security-policy'), null);
  assert.equal(page.headers.get('etag'), null);
  const css = await fetch(`${base}/style.css`);
  assert.equal(await css.text(), 'body{}');
});

test('comments are checked, and the request names each page, element and selector', () => {
  assert.equal(typeof cleanSoftwareNotes([]), 'string');
  assert.equal(typeof cleanSoftwareNotes([{ text: 'x', page: '/', what: 'the button', selector: '' }]), 'string');
  const notes = cleanSoftwareNotes([{ text: '  Make it blue ', page: '/pricing', what: 'the button \u201cBuy\u201d', selector: '#buy' }, { text: 'Too tight', page: '/', what: 'the heading', selector: 'body > main > h1' }]);
  assert.ok(Array.isArray(notes));
  const text = softwareReviewText('http://localhost:5173', { w: 390, h: 844, label: 'Phone' }, notes as never);
  assert.ok(text.startsWith('Review comments on the running app at http://localhost:5173 (seen at Phone, 390x844):'), text);
  assert.ok(text.includes('1. On /pricing, the button \u201cBuy\u201d (`#buy`): Make it blue'));
  assert.ok(text.includes('2. On /, the heading (`body > main > h1`): Too tight'));
  assert.ok(!text.includes('\u2014'));
});
