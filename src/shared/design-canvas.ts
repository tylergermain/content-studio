// The design canvas (client/ui/workspace/canvas.ts): a design is one HTML file whose name ends in
// `.design.html`, each of its artboards an element with `data-artboard` (its name) at a fixed size. A
// designer writes it; the canvas shows it live, laid out like a design tool's page, and the people
// reviewing it pin notes to its elements. Both sides read this file.

/** The suffix that makes an HTML file a design. */
export const DESIGN_SUFFIX = '.design.html';
/** The attribute an artboard carries, with its name as its value. */
export const ARTBOARD = 'data-artboard';

/** Whether a file is a design, by its name in any case. */
export function isDesignFile(file: string): boolean {
  return file.toLowerCase().endsWith(DESIGN_SUFFIX);
}

/** What a design may bring with it from beside it, by extension, with the type each is served as: its pictures, stylesheets and fonts. */
const ASSET_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
});

/** The type a design's file is served as on the canvas: the design itself, or one of its assets. Nothing for anything else. */
export function canvasType(file: string): string | undefined {
  if (isDesignFile(file)) return 'text/html';
  const name = file.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const ext = name.slice(dot).toLowerCase();
  return Object.hasOwn(ASSET_TYPES, ext) ? ASSET_TYPES[ext] : undefined;
}

/**
 * The policy a design is served with. Sandboxed with no scripts at all, so nothing in it runs, even
 * opened in a tab of its own; its origin is kept so the canvas around it can read its elements to pin
 * notes to them. It may load its own pictures, stylesheets and fonts, pictures from the web and Google
 * Fonts, and nothing else: no frames, forms or requests of its own.
 */
export const DESIGN_POLICY = [
  'sandbox allow-same-origin',
  "default-src 'none'",
  "img-src 'self' data: blob: https:",
  "media-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-ancestors 'self'",
  "form-action 'none'",
].join('; ');

/** What a file a design loads (a picture, a font) is served with. */
export const ASSET_POLICY = "default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https:; sandbox";

/** A name made safe for a file: lowercase words joined by hyphens, at most 60 characters. */
export function slugOf(name: string): string {
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return slug || 'design';
}
