// The GitHub windows behind the board cards (a PR, an issue, the label picker) live in github/; this
// is where the rest of the client finds them. A PR's or an issue's window loads the first time one
// opens: they read their comments with marked and DOMPurify, which the office's first frame needn't.
import type { GhIssue, GhPull } from '../../shared/protocol';
import type { Net } from '../net';
import type { BoardActions } from './github/prompts';
export { routePullMessage } from './github/api';
export { labelChip, openLabels } from './github/labels';

export function openIssue(first: GhIssue, net: Net, actions: BoardActions) {
  void import('./github/issue-window').then((w) => w.openIssue(first, net, actions));
}

export function openPull(first: GhPull, net: Net, actions: BoardActions) {
  void import('./github/pull-window').then((w) => w.openPull(first, net, actions));
}
