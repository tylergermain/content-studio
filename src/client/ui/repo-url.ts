// Kept apart from markdown.ts, so what only needs the repository's address doesn't load marked and
// DOMPurify with it.

/** https://github.com/owner/repo from an issue or PR URL. */
export function repoUrlOf(itemUrl: string): string {
  return itemUrl.replace(/\/(pull|issues)\/\d+.*$/, '');
}
