import type { WorkspaceKind } from './workspace.js';

/** A role a worker can be hired into. `workspace` is the interface its chat window opens with (shared/workspace.ts); the server always fills it in. */
export interface SpecialistProfile { id: string; name: string; instructions: string; tools: string[]; workspace?: WorkspaceKind }
export const specialistId = (id: unknown): id is string => typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id);
