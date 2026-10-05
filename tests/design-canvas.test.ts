import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canvasType, isDesignFile, slugOf } from '../src/shared/design-canvas.js';
import { fileTab, reviewText } from '../src/shared/workspace.js';
import { parseReview } from '../src/server/worker-chat/review.js';
import { canvasFile, canvasRelative } from '../src/server/canvas/files.js';
import { fontsIn, parseJsx, styleText, toHtml, urlsIn } from '../src/server/canvas/jsx.js';
import { exportDesign, exportNames } from '../src/server/canvas/export.js';
import { fontLinks, importPaperPage, PaperSession } from '../src/server/canvas/paper.js';

// The design canvas (shared/design-canvas.ts, client/ui/workspace/canvas.ts) and its office side:
// which files it serves, Paper's JSX as a design, PNG export, and notes pinned to elements.

function tmp(t: { after(fn: () => void): void }, name: string): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), `agent-office-${name}-`)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a design is a .design.html file, on the Canvas tab, with its pictures, styles and fonts served beside it', () => {
  assert.ok(isDesignFile('outputs/designs/launch.design.html'));
  assert.ok(isDesignFile('A.DESIGN.HTML'));
  assert.ok(!isDesignFile('notes.html'));
  assert.equal(fileTab({ path: 'x/launch.design.html', type: 'text/html' }), 'canvas');
  assert.equal(fileTab({ path: 'x/report.html', type: 'text/html' }), 'read');
  assert.equal(fileTab({ path: 'x/thumb.png', type: 'image/png' }), 'board');
  assert.equal(canvasType('a.design.html'), 'text/html');
  assert.equal(canvasType('.assets/hero.jpg'), 'image/jpeg');
  assert.equal(canvasType('fonts/brand.woff2'), 'font/woff2');
  assert.equal(canvasType('page.html'), undefined);
  assert.equal(canvasType('run.js'), undefined);
  assert.equal(slugOf('Tyler Germain \u2014 Grokbot Social Media'), 'tyler-germain-grokbot-social-media');
  assert.equal(slugOf('Caf\u00e9 \u00b7 \u00d1and\u00fa!'), 'cafe-nandu');
  assert.equal(slugOf('   '), 'design');
});

test('the canvas serves only what a design may load, never through a hidden, private or linked-out path', (t) => {
  assert.ok(canvasRelative('outputs/designs/x/.assets/hero.jpg'));
  assert.ok(canvasRelative('x.design.html'));
  assert.ok(!canvasRelative('../x.design.html'));
  assert.ok(!canvasRelative('/etc/x.design.html'));
  assert.ok(!canvasRelative('.git/x.png'));
  assert.ok(!canvasRelative('.assets'));
  assert.ok(!canvasRelative('a/.env/x.png'));
  assert.ok(!canvasRelative('node_modules/x.png'));
  assert.ok(!canvasRelative('secrets/x.png'));
  assert.ok(!canvasRelative('api-key.png'));
  assert.ok(!canvasRelative('x.js'));

  const root = tmp(t, 'canvas-files');
  const outside = tmp(t, 'canvas-outside');
  writeFileSync(path.join(outside, 'secret.png'), 'x');
  mkdirSync(path.join(root, 'd', '.assets'), { recursive: true });
  writeFileSync(path.join(root, 'd', 'x.design.html'), '<html></html>');
  writeFileSync(path.join(root, 'd', '.assets', 'a.png'), 'png');
  symlinkSync(path.join(outside, 'secret.png'), path.join(root, 'd', 'out.png'));
  return Promise.all([
    canvasFile(root, 'd/x.design.html').then((f) => assert.equal(f?.type, 'text/html')),
    canvasFile(root, 'd/.assets/a.png').then((f) => assert.equal(f?.type, 'image/png')),
    canvasFile(root, 'd/out.png').then((f) => assert.equal(f, undefined)),
    canvasFile(root, 'd/missing.png').then((f) => assert.equal(f, undefined)),
  ]);
});

const SAMPLE = `(
    <div style={{ backgroundColor: '#101112', boxSizing: 'border-box', overflow: 'clip', position: 'relative', WebkitFontSmoothing: 'antialiased' }}>
      <div style={{ backgroundImage: 'url(https://app.paper.design/file-assets/F1/ABC123.jpg)', backgroundSize: 'cover', height: '2700px', left: -540, position: 'absolute', top: -630, width: '2160px' }} />
      <div style={{ color: '#FFFFFF', fontFamily: '"Inter", system-ui, sans-serif', fontSize: '96px', fontWeight: 900, lineHeight: 1.1, opacity: 0.9 }}>
        PLAN YOUR NEXT<br />CONTENT &amp; SHOOT
        {' '}
        {/* a comment */}
        <span onClick={'alert(1)'} className="hi">with AI</span>
      </div>
      <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg" style={{ left: 0, position: 'absolute' }}>
        <path d="M3 2H27V38L15 29L3 38Z" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinejoin="round" />
      </svg>
      <script>{'alert(2)'}</script>
      <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700 }}>from idea to shot list</div>
    </div>
  )`;

test("Paper's JSX becomes a design's HTML: styles, text, drawings and pictures, with nothing that runs", () => {
  const el = parseJsx(SAMPLE);
  const html = toHtml(el, { root: { attrs: [['data-artboard', 'Slide "1"']], style: { width: '1080px', height: '1350px' } }, url: (u) => u.replace(/^https:\/\/app\.paper\.design\/file-assets\/F1\//, '.assets/') });
  assert.match(html, /^<div data-artboard="Slide &quot;1&quot;" style="width: 1080px; height: 1350px; background-color: #101112; box-sizing: border-box; overflow: clip; position: relative; -webkit-font-smoothing: antialiased">/);
  assert.ok(html.includes('background-image: url(.assets/ABC123.jpg)'), html);
  assert.ok(html.includes('left: -540px') && html.includes('top: -630px'));
  // Numbers of unitless properties stay numbers.
  assert.ok(html.includes('font-weight: 900') && html.includes('line-height: 1.1') && html.includes('opacity: 0.9'));
  assert.ok(html.includes('font-family: &quot;Inter&quot;, system-ui, sans-serif'));
  assert.ok(html.includes('PLAN YOUR NEXT<br>CONTENT &amp; SHOOT'), html);
  assert.ok(html.includes('<span class="hi">with AI</span>'), html);
  assert.ok(html.includes('viewBox="0 0 30 40"') && html.includes('stroke-width="3"') && html.includes('stroke-linejoin="round"'));
  assert.ok(!/onclick|script|alert/i.test(html), html);
  assert.deepEqual([...urlsIn(el)], ['https://app.paper.design/file-assets/F1/ABC123.jpg']);
  assert.deepEqual([...fontsIn(el)].map(([f, w]) => [f, [...w]]), [['Inter', [900]], ['Caveat', [700]]]);
  assert.equal(styleText({ marginTop: 0, zIndex: 2, MozOsxFontSmoothing: 'grayscale', msTransform: 'none', '--brand': '#fff' }), 'margin-top: 0; z-index: 2; -moz-osx-font-smoothing: grayscale; -ms-transform: none; --brand: #fff');
  assert.throws(() => parseJsx('<div {...props} />'), /Spread/);
});

test('fonts come from Google Fonts one weight at a time, and system fonts are left to the computer', () => {
  const links = fontLinks(new Map([['Inter', new Set([900, 400])], ['Caveat', new Set([700])], ['system-ui', new Set([400])], ['SF Pro Display', new Set([600])]]));
  assert.deepEqual(links, [
    'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap',
    'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400&display=swap',
    'https://fonts.googleapis.com/css2?family=Inter:wght@900&display=swap',
    'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,900&display=swap',
    'https://fonts.googleapis.com/css2?family=Caveat:wght@700&display=swap',
  ]);
});

test('a note pinned to an element of a design says where it is, and the designer changes the design itself', () => {
  const review = parseReview({ kind: 'notes', requestId: 'r1', files: [{ path: 'd/launch.design.html' }], notes: [{ at: 0, text: 'Bigger', where: 'artboard \u201cSlide 1\u201d, text \u201cPLAN\u201d, at [data-artboard="Slide 1"] > div:nth-of-type(2)' }, { at: 0, text: 'Bluer' }] });
  assert.ok(!('error' in review), JSON.stringify(review));
  if ('error' in review) return;
  assert.equal(review.notes?.[0].where?.startsWith('artboard'), true);
  const text = reviewText('notes', ['/Users/a/d/launch.design.html'], review.notes);
  assert.ok(text.includes('- On artboard \u201cSlide 1\u201d, text \u201cPLAN\u201d, at [data-artboard="Slide 1"] > div:nth-of-type(2): Bigger'), text);
  assert.ok(text.includes('- 0:00 Bluer'), text);
  assert.ok(text.includes('Make these changes in that design file itself'), text);
  assert.ok(!text.includes('v02'), text);
  // A cut's notes are as they were.
  assert.ok(reviewText('notes', ['/Users/a/cut-v01.mp4'], [{ at: 61, text: 'Trim' }]).includes('new file with v02'));
  assert.ok('error' in parseReview({ kind: 'notes', requestId: 'r2', files: [{ path: 'd/x.design.html' }], notes: [{ at: 0, text: 'x', where: '\u0007' }] }));
});

test('export names each PNG after the design and its artboard, uniquely', () => {
  assert.deepEqual(exportNames('out/launch.design.html', ['Slide 1', 'Slide 1', '', 'Caf\u00e9']), ['launch-slide-1.png', 'launch-slide-1-2.png', 'launch-artboard.png', 'launch-cafe.png']);
});

test('export renders each artboard at its own size beside the design', async (t) => {
  const root = tmp(t, 'canvas-export');
  mkdirSync(path.join(root, 'd', '.assets'), { recursive: true });
  // A 2x2 red PNG.
  writeFileSync(path.join(root, 'd', '.assets', 'dot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAwMDAAAAMAAHKvtIYAAAAAElFTkSuQmCC', 'base64'));
  writeFileSync(path.join(root, 'd', 'launch.design.html'), `<!doctype html><html><body>
    <div data-artboard="Square" style="width:300px;height:300px;background:url(.assets/dot.png)"></div>
    <div data-artboard="Wide" style="width:640px;height:200px;background:#218cff"><script>document.body.innerHTML=''</script></div>
  </body></html>`);
  const out = await exportDesign(root, 'd/launch.design.html');
  if (typeof out === 'string' && /headless Chromium|playwright-core/.test(out)) return t.skip(out);
  assert.equal(typeof out, 'object', String(out));
  if (typeof out === 'string') return;
  assert.deepEqual(out.files, ['d/launch-square.png', 'd/launch-wide.png']);
  const size = (f: string) => {
    const b = readFileSync(path.join(root, f));
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  assert.deepEqual(size('d/launch-square.png'), [300, 300]);
  assert.deepEqual(size('d/launch-wide.png'), [640, 200]);
  assert.equal(typeof (await exportDesign(root, 'd/missing.design.html')), 'string');
});

/** Speaks MCP like `paper mcp`, with one page of two artboards. */
const fakePaper = `#!/usr/bin/env node
const rl = require('node:readline').createInterface({ input: process.stdin });
const header = { type: 'text', text: JSON.stringify({ file: { id: 'F1', name: 'Launch' }, contentHash: { tokens: 'x' } }) };
const say = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') return say(m.id, { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake', version: '0' } });
  if (m.method !== 'tools/call') return;
  const { name, arguments: a } = m.params;
  if (name === 'list_files') return say(m.id, { content: [{ type: 'text', text: JSON.stringify({ files: [{ id: 'F1', name: 'Launch', open: true, active: true }] }) }] });
  if (name === 'get_basic_info') return say(m.id, { content: [header, { type: 'text', text: JSON.stringify({ fileName: 'Launch', pageName: 'Page 1', artboards: [{ id: 'A1', name: 'Cover', width: 1080, height: 1350, worldX: 0, worldY: 0 }, { id: 'A2', name: 'Strip', width: null, height: null, worldX: 1160, worldY: 0 }] }) }] });
  if (name === 'get_jsx') return say(m.id, { content: [header, { type: 'text', text: a.nodeId === 'A1' ? "(<div style={{ position: 'relative', backgroundImage: 'url(https://example.com/x.png)' }}><div style={{ fontFamily: '\\"Inter\\", sans-serif', fontWeight: 800 }}>Hello</div></div>)" : "(<div style={{ display: 'flex' }}>Strip</div>)" }] });
  say(m.id, { isError: true, content: [{ type: 'text', text: 'unknown tool ' + name }] });
});
`;

test('a page of a Paper file comes across as a design, its artboards placed as they were', async (t) => {
  const root = tmp(t, 'canvas-paper');
  const bin = path.join(root, 'paper');
  writeFileSync(bin, fakePaper, { mode: 0o755 });
  const out = await importPaperPage(root, 'designs', 'F1', undefined, new PaperSession(bin));
  assert.equal(typeof out, 'object', String(out));
  if (typeof out === 'string') return;
  assert.equal(out.path, path.join('designs', 'launch', 'launch.design.html'));
  assert.equal(out.artboards, 2);
  const html = readFileSync(path.join(root, out.path), 'utf8');
  assert.ok(html.includes('<div data-artboard="Cover" data-x="0" data-y="0" style="width: 1080px; height: 1350px; position: relative'), html);
  assert.ok(html.includes('<div data-artboard="Strip" data-x="1160" data-y="0" style="display: flex">Strip</div>'), html);
  assert.ok(html.includes('https://fonts.googleapis.com/css2?family=Inter:wght@800&amp;display=swap') && html.includes('family=Inter:opsz,wght@14..32,800'), html);
  // Pictures that aren't Paper's own stay where they are.
  assert.ok(html.includes('url(https://example.com/x.png)'));
  assert.ok(existsSync(path.join(root, 'designs', 'launch', '.assets')));
  // A second import goes in a folder of its own.
  const again = await importPaperPage(root, 'designs', 'F1', undefined, new PaperSession(bin));
  assert.ok(typeof again === 'object' && again.path === path.join('designs', 'launch-2', 'launch.design.html'), String(typeof again === 'string' ? again : again.path));
});
