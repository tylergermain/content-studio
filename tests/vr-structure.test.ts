import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// VR mode's shape (docs/vr.md): a desktop loads nothing of it but the Enter VR button, the emulator
// the headless checks use never reaches the office's own code, and VR plugs in with one install line.

const root = path.join(import.meta.dirname, '..');
const client = path.join(root, 'src/client');
const vr = path.join(client, 'features/vr');
const read = (file: string) => readFileSync(file, 'utf8');

/** What a client module loads at run time (`import type` aside), resolved to files: `./foo` is foo.ts or foo/index.ts. */
function loads(file: string): string[] {
  const out: string[] = [];
  for (const m of read(file).matchAll(/^\s*(import|export)\s(type\s)?[^'"]*?from\s+'(\.[^']+)'|^\s*import\s+'(\.[^']+)'/gm)) {
    if (m[2]) continue;
    const spec = m[3] ?? m[4];
    if (spec.endsWith('.css') || spec.includes('?')) continue;
    const base = path.resolve(path.dirname(file), spec.replace(/\.js$/, ''));
    const found = [`${base}.ts`, path.join(base, 'index.ts'), base].find((f) => existsSync(f) && statSync(f).isFile());
    if (found) out.push(found);
  }
  return out;
}

/** Every module `entry` loads at run time, itself included. */
function graph(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    todo.push(...loads(f));
  }
  return seen;
}

/** Every file under `dir` (relative to it), skipping nothing. */
const walk = (dir: string) => (readdirSync(dir, { recursive: true }) as string[]).filter((f) => statSync(path.join(dir, f)).isFile());

test('the office\'s first load carries only the Enter VR button: the session, and someone else\'s head and hands, load when they\'re needed', () => {
  const first = [...graph(path.join(client, 'main.ts'))].filter((f) => f.startsWith(vr + path.sep)).map((f) => path.relative(vr, f));
  assert.deepEqual(first.sort(), ['button.ts', 'index.ts'], 'main.ts loads only these of features/vr up front (types are types only)');
  const index = read(path.join(vr, 'index.ts'));
  assert.match(index, /import\(\s*'\.\/session'\s*\)/, 'the session is a chunk of its own, loaded once VR starts');
  assert.match(index, /import\(\s*'\.\/remote'\s*\)/, 'and so is showing someone else in VR');
  // Nothing else in the office reaches into VR's parts.
  for (const rel of walk(client)) {
    const file = path.join(client, rel);
    if (!rel.endsWith('.ts') || file.startsWith(vr + path.sep)) continue;
    for (const dep of loads(file)) {
      if (!dep.startsWith(vr + path.sep)) continue;
      assert.equal(path.relative(client, file), 'main.ts', `${rel} loads ${path.relative(client, dep)}`);
      assert.equal(path.relative(vr, dep), 'index.ts', `main.ts loads ${path.relative(client, dep)}`);
    }
  }
});

test('nothing under src/ imports the emulator (iwer): it is pinned for the headless checks alone', () => {
  const uses = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](?:iwer|@iwer\/[^'"]*)['"]/;
  for (const rel of walk(path.join(root, 'src'))) {
    if (!/\.(ts|tsx|js|mjs|html|css)$/.test(rel)) continue;
    assert.doesNotMatch(read(path.join(root, 'src', rel)), uses, `src/${rel} imports iwer`);
  }
  const pkg = JSON.parse(read(path.join(root, 'package.json'))) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  assert.equal(pkg.devDependencies?.iwer, '2.5.0', 'pinned exactly, as a devDependency');
  assert.equal(pkg.dependencies?.iwer, undefined, 'never something the office ships with');
  // The harness is what loads it.
  assert.match(read(path.join(root, 'tests/support/vr-browser.mjs')), /iwer/);
});

test('VR plugs in with one install function, called right after the frame loop it borrows is made', () => {
  const installs = walk(vr)
    .filter((f) => f.endsWith('.ts'))
    .flatMap((f) => [...read(path.join(vr, f)).matchAll(/^export function (install\w+)\(/gm)].map((m) => `${f}:${m[1]}`));
  assert.deepEqual(installs, ['index.ts:installVr']);
  const main = read(path.join(client, 'main.ts'));
  assert.equal(main.split('installVr(ctx').length - 1, 1, 'main.ts calls installVr once');
  const loop = main.indexOf('frameLoop(ctx');
  assert.ok(loop >= 0 && main.indexOf('installVr(ctx, parts, { loop: frame })') > loop, 'with the frame loop main.ts made');
});
