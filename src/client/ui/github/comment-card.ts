// A comment on an issue or a pull request, as its window shows it: kept apart from pieces.ts, so what
// only needs the small pieces (the boards' label chips) doesn't load marked and DOMPurify with it.
import type { GhComment } from '../../../shared/protocol';
import { h } from '../dom';
import { markdown } from '../markdown';
import { avatar, when } from './pieces';

export function commentCard(c: GhComment, itemUrl: string, verb: string, badge?: [string, string]) {
  return h(
    'article.gh-card',
    { class: badge?.[1] ? `is-${badge[1]}` : '' },
    h('header', {}, avatar(c.author), h('b', {}, c.author), h('span', {}, verb), when(c.createdAt, c.url), badge ? h('span.gh-badge', { class: badge[1] }, badge[0]) : null),
    c.body.trim() || !badge ? markdown(c.body, itemUrl) : null,
  );
}
