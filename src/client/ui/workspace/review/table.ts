import { store } from '../../../state';
import type { WorkspaceHost } from '../types';
import { TABLE } from './api';
import { openReviewRoom } from './room';

// Software review of a project table's app (from its panel, ui/table-info/, and the Rooms panel's Review): the servers
// the agents at the table run, or its app's address, opened on `target` (one of them, as review/targets.ts keys it). What's sent from it goes to a new agent hired at the table to do it
// (server/http/routes/table-review.ts); with no app running, it offers to hire one to start it.

export function openTableReview(room: { id: string; name: string }, target?: string) {
  const host: WorkspaceHost = {
    workerId: `${TABLE}${room.id}`,
    workerName: room.name,
    get admin() {
      return store.me.admin;
    },
    // Sending is hiring: whoever may hire here (the office checks).
    canSend: () => store.me.admin,
    url: () => '',
    review: async () => {},
    refresh: async () => {},
    draft: () => {},
  };
  openReviewRoom(host, { target });
}
