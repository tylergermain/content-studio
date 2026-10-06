// The executive assistant (server/assistant/, client/ui/agents/assistant.ts): an agent with no desk and no body,
// in the Agents panel, that keeps the office's agents organized. No Node and no DOM here: both sides read it.

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  /** Who asked (a user message), as the office knows them. */
  by?: string;
  /** What it did on the way to its answer: the office commands it ran. */
  steps?: string[];
}

/** One window of a plan's limits: how much of it is used, and when it starts again. */
export interface PlanWindow {
  label: string;
  pct: number;
  resetsAt?: number;
}

/** A plan's usage: Codex's from its own sessions, Claude's from Claude Code (server/limits.ts). */
export interface PlanUsage {
  provider: 'codex' | 'claude';
  plan?: string;
  windows: PlanWindow[];
  /** Credits left beyond the plan (Codex). */
  credits?: string;
  at: number;
}

export interface AssistantState {
  /** Answering now, with what it's doing so far. */
  busy: boolean;
  doing: string[];
  /** Questions waiting their turn. */
  queued: number;
  messages: AssistantMessage[];
  plans: PlanUsage[];
  /** Tokens its own answers have used, since it started (or was started over). */
  used: { input: number; cached: number; output: number; turns: number };
  error?: string;
}

/** The quick asks the panel offers, as written to the assistant. */
export const ASSISTANT_ASKS: { label: string; text: string }[] = [
  { label: 'What’s everyone doing?', text: 'Give me a quick rundown of every agent: what each is working on and which ones need me.' },
  { label: 'Who can go home?', text: 'Which agents are finished or idle and could go home without losing work? List them with why, and don’t send anyone home yet.' },
  { label: 'Tidy up', text: 'Tidy up: send home every agent that is finished or idle and whose work is saved, then tell me who went and who stayed and why.' },
  { label: 'Am I using my tokens well?', text: 'Look at my plan usage and how many agents are working. Am I using my tokens well? Should I start more work, or slow down?' },
];

/** A plan window's length as people say it: "5 hours", "week". */
export function windowLabel(minutes: number): string {
  if (minutes >= 10_080 - 60 && minutes <= 10_080 + 60) return 'week';
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minutes`;
}
