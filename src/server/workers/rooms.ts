import { existsSync } from 'node:fs';
import path from 'node:path';
import type { WorkerProject } from '../../shared/project-rooms.js';
import { excludeFromGit } from '../config.js';
import { Worktrees } from '../worktrees.js';

// The project rooms' repositories a floor's workers have worktrees of (see shared/project-rooms.ts): a worker hired in
// a room whose project is a git checkout works in a worktree of that, kept in its own .agent-office/worktrees (out of
// its git, as the floor's is), rather than one of the floor's. The worker's worktree says which (WorkerInfo.worktree.root).

export class RoomRepos {
  private trees = new Map<string, Worktrees>();

  constructor(private floor: Worktrees) {}

  /** Git plumbing for the checkout the worktree `wt` is of: this floor's, or the room repository it says (`root`). */
  treesAt(wt?: { root?: string }): Worktrees {
    if (!wt?.root) return this.floor;
    let trees = this.trees.get(wt.root);
    if (!trees) {
      excludeFromGit(wt.root);
      this.trees.set(wt.root, (trees = new Worktrees(wt.root)));
    }
    return trees;
  }

  /** The repository a project room's workers have worktrees of: its folder, when that's a git checkout. */
  repoOf(project: WorkerProject | undefined): string | undefined {
    return project?.dir && existsSync(path.join(project.dir, '.git')) ? project.dir : undefined;
  }

  /** Fetches the branch the room's repository is on, before a worker's worktree of it is made (as fetchBase does the floor's). */
  fetch(project: WorkerProject | undefined): Promise<void> | undefined {
    const dir = this.repoOf(project);
    return dir ? this.treesAt({ root: dir }).fetch() : undefined;
  }
}
