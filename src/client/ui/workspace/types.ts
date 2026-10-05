import type { ChatArtifact, ChatSnapshot, ReviewRequest } from '../../../shared/worker-chat';

/** What a workspace panel may ask of the chat window that holds it. */
export interface WorkspaceHost {
  workerId: string;
  workerName: string;
  admin: boolean;
  /** False when the viewer may watch this worker but not direct it (snapshot.canSend). */
  canSend(): boolean;
  /** The /file URL that serves a file, in the worker's folder or in a share. */
  url(f: { root?: string; path: string }): string;
  /** Sends one review (notes, approve, variations or a question) as one POST /api/worker-chat/review. */
  review(r: Omit<ReviewRequest, 'requestId'>): Promise<void>;
  /** Fetches a fresh snapshot now, so a sent review shows its badge. */
  refresh(): Promise<void>;
}

/**
 * One tab's view. `paint` gets that tab's files in list order ("From <worker>" first: its links, remembered links,
 * then the files beside them; then "On this floor"), and runs again only when those files, a review or `canSend`
 * change. `show` opens one of them. files.ts has what every panel lists files with: `sections`, `latestLinked`,
 * `badges`, `reviewsOf`, `fileItem` and `previewStage`. F (theater mode) belongs to the frame, not to a panel.
 */
export interface Panel {
  element: HTMLElement;
  paint(files: ChatArtifact[], data: ChatSnapshot): void;
  show(file: ChatArtifact): void;
  /** Keys while the workspace has focus: never Escape, never while typing. True when handled. */
  key?(e: KeyboardEvent): boolean;
  stop(): void;
}

/** The chat window's right-hand side: tabs by output type, each with its panel. */
export interface Workspace {
  element: HTMLElement;
  paint(data: ChatSnapshot): void;
  /** Opens a file by its `artifactKey`, switching to its tab. */
  show(key: string): void;
  stop(): void;
}
