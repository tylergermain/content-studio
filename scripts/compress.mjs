// After the client's built (npm run build:client): a brotli and a gzip copy of each of its files worth
// compressing, next to it (main-abc.js.br, main-abc.js.gz), for the office to send to a browser that takes
// them (server/http/static.ts). Done once here, at the best compression, rather than on every request.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '../dist/public');
const WORTH = /\.(js|css|html|svg|json|wasm|glb|txt|map)$/;
let before = 0, after = 0, files = 0;
const walk = (dir) => {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, d.name);
    if (d.isDirectory()) walk(file);
    else if (WORTH.test(d.name) && statSync(file).size > 1024) {
      const raw = readFileSync(file);
      const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
      const gz = gzipSync(raw, { level: 9 });
      // Only where it's worth it: some files (a model already squeezed) come out no smaller.
      if (br.length < raw.length * 0.9) writeFileSync(`${file}.br`, br);
      if (gz.length < raw.length * 0.9) writeFileSync(`${file}.gz`, gz);
      before += raw.length;
      after += Math.min(br.length, raw.length);
      files++;
    }
  }
};
walk(root);
console.log(`compressed ${files} files: ${(before / 1e6).toFixed(1)} MB down to ${(after / 1e6).toFixed(1)} MB with brotli`);
