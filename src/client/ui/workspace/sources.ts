// The Sources rail in the report reader (reader.ts): every web page a report cites, once each, numbered in the
// order the report first cites it, with the site and the best name the report gives it. Pure, so
// tests/report-sources.test.ts runs it in node.

/** One web link as the report writes it: where it goes and the words it is on. */
export interface SourceLink { href: string; text: string }

/** One cited page. */
export interface Source {
  /** From 1, in the order the report first cites it. */
  n: number;
  /** What two links to the same page share (see `sourceKey`). */
  key: string;
  /** The address as the report first wrote it. */
  url: string;
  /** The site, without a leading www. */
  host: string;
  /** The first link text that says more than the address, else the address without its scheme. */
  title: string;
  /** Whether `title` came from the report's own words. */
  named: boolean;
  /** How many times the report links it. */
  count: number;
}

const WEB = /^https?:$/;

/**
 * What makes two links one source: the site without www, the port, the path without a trailing slash and the query
 * without utm_ tracking. The scheme and the #fragment don't count. Undefined for anything but an http(s) address.
 */
export function sourceKey(href: string): string | undefined {
  let u: URL;
  try { u = new URL(href.trim()); } catch { return undefined; }
  if (!WEB.test(u.protocol) || !u.hostname) return undefined;
  for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
  const query = u.searchParams.toString();
  return `${host(u)}${u.port ? `:${u.port}` : ''}${u.pathname.replace(/\/+$/, '')}${query ? `?${query}` : ''}`;
}

const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');

/** Link text worth showing as a name: not empty, and not just the address or the site again. */
function nameOf(text: string, u: URL): string | undefined {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  const bare = (s: string) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  if (bare(t) === bare(u.href) || bare(t) === host(u) || /^https?:\/\//i.test(t)) return undefined;
  return t.length > 140 ? `${t.slice(0, 139)}…` : t;
}

/** The address without its scheme or www, decoded where it can be, for a source the report never names. */
function plain(u: URL): string {
  let rest = `${u.pathname.replace(/\/+$/, '')}${u.search}`;
  try { rest = decodeURI(rest); } catch { /* leave it encoded */ }
  const s = `${host(u)}${rest}`;
  return s.length > 140 ? `${s.slice(0, 139)}…` : s;
}

/** The report's web links as sources: de-duplicated by `sourceKey`, numbered by first citation. */
export function groupSources(links: readonly SourceLink[]): Source[] {
  const out = new Map<string, Source>();
  for (const link of links) {
    const key = sourceKey(link.href);
    if (!key) continue;
    const u = new URL(link.href.trim());
    const name = nameOf(link.text, u);
    const seen = out.get(key);
    if (seen) {
      seen.count++;
      if (!seen.named && name) { seen.title = name; seen.named = true; }
      continue;
    }
    out.set(key, { n: out.size + 1, key, url: link.href.trim(), host: host(u), title: name ?? plain(u), named: !!name, count: 1 });
  }
  return [...out.values()];
}

const BARE = /\bhttps?:\/\/[^\s<>"'`]+/g;
const count = (s: string, c: string) => s.split(c).length - 1;

/**
 * The web addresses written out in plain text (a .txt or .csv of notes), where each starts and the address itself,
 * without the punctuation that ends a sentence around it: a closing bracket stays only when the address opened one,
 * as Wikipedia's do.
 */
export function bareUrls(text: string): { at: number; url: string }[] {
  const out: { at: number; url: string }[] = [];
  for (const m of text.matchAll(BARE)) {
    let url = m[0];
    for (;;) {
      const last = url.at(-1) ?? '';
      if (last && '.,;:!?*'.includes(last)) url = url.slice(0, -1);
      else if (last === ')' && count(url, ')') > count(url, '(')) url = url.slice(0, -1);
      else if (last === ']' && count(url, ']') > count(url, '[')) url = url.slice(0, -1);
      else break;
    }
    if (sourceKey(url)) out.push({ at: m.index, url });
  }
  return out;
}

/** The list "Copy sources" puts on the clipboard: one numbered line each, the name then the address. */
export function sourcesText(sources: readonly Source[]): string {
  return sources.map((s) => `${s.n}. ${s.named ? `${s.title}: ` : ''}${s.url}`).join('\n');
}
