// A floor made its own (see shared/studio.ts): what its wall boards and kiosks are for, what's posted
// on the boards, the prices on its stock ticker, and what the office is signed in to so it can fill
// boards by itself.

import type { WorkspaceTab } from '../workspace.js';
import type { IntegrationsState, SlackChannel, StudioBoard, StudioSetup, StudioState, TickerState } from '../studio.js';

export type StudioClientMsg =
  /** Make the floor's boards, kiosk agents and ticker what `setup` says (admins only). */
  | { t: 'studio.setup'; setup: StudioSetup }
  /** Turn the floor's apps on and off: the ones in `off` go off, the rest are on (admins only; see shared/apps.ts). */
  | { t: 'studio.apps'; off: WorkspaceTab[] }
  /** Put a post up on one of the floor's boards. */
  | { t: 'studio.post'; board: StudioBoard; title: string; body?: string; url?: string; source?: string }
  /** Take a post down. */
  | { t: 'studio.unpost'; id: string }
  /** You opened a board: what's on it isn't new any more, for anyone on the floor. */
  | { t: 'studio.seen'; board: StudioBoard }
  /**
   * Sign the office in to Slack (a token) or Metricool (a token, the user's id and the brand's), or out
   * again with '' or null: admins only. The office keeps them to itself; nobody is ever sent one back.
   */
  | { t: 'integrations.signIn'; slack?: string; metricool?: { token: string; userId: string; blogId: string } | null }
  /** The Slack channels the office can read, for picking which a board watches; answered with `integrations.channels`. */
  | { t: 'integrations.channels' };

export type StudioServerMsg =
  /** Your floor's boards changed: how they're set up, or what's on them. */
  | { t: 'studio'; studio: StudioState }
  /** The prices on your floor's ticker. */
  | { t: 'ticker'; ticker: TickerState }
  | { t: 'integrations'; state: IntegrationsState }
  /** Sent to whoever asked. */
  | { t: 'integrations.channels'; channels: SlackChannel[]; error?: string };
