import { WORKSPACE_TABS, type WorkspaceTab } from './workspace.js';

// The office's apps: the tools a worker's window has beside the conversation (see shared/workspace.ts
// and client/ui/workspace/), each one a tab. An admin turns each on or off for a floor with a
// checkmark (☰ › Apps); nothing is installed. A role still says which app its window opens on first.
// Files is always on, so nothing a worker makes is ever out of reach.

export interface AppDef {
  tab: WorkspaceTab;
  icon: string;
  name: string;
  about: string;
  /** It can't be turned off. */
  always?: boolean;
}

export const APPS: readonly AppDef[] = [
  { tab: 'canvas', icon: '🎨', name: 'Design canvas', about: 'Designs live as they’re saved: click anything on them to pin a note, export PNGs, bring pages in from Paper.' },
  { tab: 'board', icon: '🖼️', name: 'Image board', about: 'Compare images side by side and at YouTube size, pick one, or ask for variations.' },
  { tab: 'watch', icon: '🎬', name: 'Screening room', about: 'Watch each cut, leave notes at timestamps, send them back as a revision request, and approve the final version.' },
  { tab: 'read', icon: '📄', name: 'Reports', about: 'Read reports with their sources beside them, ask about them, and approve them.' },
  { tab: 'files', icon: '📁', name: 'Files', about: 'Every file a worker links or makes. Always on.', always: true },
];

/** Which apps a floor has turned off (none: all on). */
export interface AppsSetup {
  off: WorkspaceTab[];
}

/** The apps a floor has off, from somewhere it can't be trusted: real apps, each once, never one that's always on; nothing when all are on. */
export function cleanApps(raw: unknown): AppsSetup | undefined {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).off) ? ((raw as Record<string, unknown>).off as unknown[]) : [];
  const off = WORKSPACE_TABS.filter((t) => list.includes(t) && !APPS.find((a) => a.tab === t)?.always);
  return off.length ? { off } : undefined;
}

/** Whether an app is on for a floor with this setup. */
export function appOn(setup: { apps?: AppsSetup } | undefined, tab: WorkspaceTab): boolean {
  return !!APPS.find((a) => a.tab === tab)?.always || !setup?.apps?.off.includes(tab);
}
