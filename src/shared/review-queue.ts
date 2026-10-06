import type { WorkspaceTab } from './workspace.js';

// The review queue (server/review-queue/): every agent's finished task, office-wide, waiting for someone to look at
// it in the app that suits it (picked by Jev, TypeSafe's decision model, or by what the worker made when Jev can't
// be asked), and what became of each: approved, sent back with notes, or dismissed.

/** What became of an item: waiting to be looked at, or decided. */
export type ReviewState = 'waiting' | 'approved' | 'notes' | 'dismissed';

export interface ReviewItem {
  id: string;
  floor: string;
  floorName: string;
  workerId: string;
  workerName: string;
  /** What it was asked to do, in a line. */
  task: string;
  /** What it said when it finished, clipped. */
  said?: string;
  /** The files it linked or made this turn, newest first, as the worker's window knows them (`root`: a shared folder). */
  files: { path: string; type: string; root?: string }[];
  /** The app it's shown in, and who said so: Jev (with how sure it was) or the files themselves. */
  app: WorkspaceTab;
  by: 'jev' | 'files';
  confidence?: number;
  /** When it finished (and joined the queue), and when it was last brought up to date by finishing again. */
  at: number;
  updatedAt: number;
  state: ReviewState;
  decidedAt?: number;
  decidedBy?: string;
}

export interface ReviewQueueView {
  items: ReviewItem[];
  waiting: number;
  /** Whether Jev picks the apps here (the office has a TypeSafe key). */
  jev: boolean;
}

/** The apps an item can be shown in, as Jev is asked about them (Files is always one). */
export const REVIEW_APPS: Record<WorkspaceTab, string> = {
  watch: 'Screening room: a video or audio cut to watch, with notes at timestamps',
  board: 'Image board: still images (thumbnails, carousels, photos, mockups) to compare and pick from',
  read: 'Reports: a written document, report, script or research to read',
  canvas: 'Design canvas: a design made on the design canvas (artboards, layouts)',
  review: 'Software review: a web app or site the worker is running, to use and click to comment on',
  files: 'Files: anything else, a mix of kinds, or nothing to look at but the message',
};

/** An item's line in a list: the worker and its task. */
export function itemTitle(i: Pick<ReviewItem, 'workerName' | 'task'>): string {
  return `${i.workerName}: ${i.task}`;
}
