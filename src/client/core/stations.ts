/** The board agents: what each is for, and the ones waiting by their boards before anyone has asked them anything. */
import { STATION_AGENT, type StationKind } from '../../shared/layout';
import { store } from '../state';
import { resolvedProvider } from '../ui/provider';
import { Worker } from '../world/character';
import type { DeskView } from '../world/types';
import type { World } from '../world/world';
import { noOutline } from './outline';

/** What each board agent is for: its board's icon, what it offers on the card over its head, and an example ask. */
export const STATION_INFO: Record<StationKind, { icon: string; offer: string; does: string; example: string }> = {
  issues: { icon: '📌', offer: 'Ask me about issues', does: 'I file, find, triage, label and close them', example: 'File an issue: the dog walks straight through the jukebox' },
  pulls: { icon: '🔀', offer: 'Ask me about PRs', does: 'I sum up, review, comment on and merge them', example: 'Review the newest PR and tell me if it’s ready to merge' },
  queue: { icon: '📋', offer: 'Ask me to queue work', does: 'I turn it into tasks for fresh workers', example: 'Queue every open bug issue, most important first' },
};

/** What the agent at a kiosk is called on the floor you're on: the floor's own name for it, when it has one (see shared/studio.ts). */
export function stationName(kind: StationKind): string {
  return store.studio.setup.agents[kind]?.name ?? STATION_AGENT[kind].name;
}

/** What it's for there: as the floor has briefed it, else as the office has it. */
export function stationInfo(kind: StationKind): { icon: string; offer: string; does: string; example: string } {
  const mine = store.studio.setup.agents[kind];
  if (!mine) return STATION_INFO[kind];
  const offer = mine.offer || `Ask the ${mine.name}`;
  // What it does, as its brief opens: its first sentence.
  const does = (/^[^.!?\n]{8,110}[.!?]?/.exec(mine.brief)?.[0] ?? offer).trim();
  return { icon: '🧑‍💼', offer, does, example: 'What can you do for me?' };
}

/** A board agent waiting by its board before anyone has asked it anything (see buildKiosk), and where. */
export interface IdleAgent {
  model: Worker;
  view: DeskView;
}

/** The board agents waiting by their boards in `w`. */
export function idleAgentsIn(w: World): IdleAgent[] {
  return w.plan.stations.map((def) => {
    const kind = def.station!;
    const model = new Worker(stationName(kind), STATION_AGENT[kind].color);
    model.setStatus('idle', false);
    model.setTask({ name: stationInfo(kind).offer, summary: stationInfo(kind).does });
    // On a floor with agents of its own, the ones waiting are who that floor has there.
    store.on('studio', () => {
      model.setName(stationName(kind));
      model.setTask({ name: stationInfo(kind).offer, summary: stationInfo(kind).does });
    });
    model.setOutfit(w.plan.agents.outfit === 'peasant' ? 'peasant' : null);
    // It runs on whatever the office hires by default, and wears that on its antenna.
    const wear = () => model.setProvider(resolvedProvider(undefined, store.project));
    wear();
    store.on('project', wear);
    const view = w.desks.get(def.id)!;
    view.vacancy.children[0].add(model.root);
    noOutline(model.root);
    return { model, view };
  });
}
