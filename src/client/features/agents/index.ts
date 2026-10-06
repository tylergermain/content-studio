/**
 * The Agents panel (ui/agents/panel.ts) in the 3D office: \u2630 \u203a Agents, with how many agents need someone on every
 * floor beside it (pin it to keep it on the top bar). Opening one on another floor rides there first, then opens its window once it's arrived;
 * a new task on another floor does the same with the hire dialog.
 */
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { openAgentsPanel, whenReady as when } from '../../ui/agents/panel';
import { addHudAction } from '../../ui/menu';

export interface AgentsPanelDeps {
  openWorker(id: string): void;
  switchFloor(floorId: string): void;
  firstFreeSeat(): string | undefined;
  hireAtDesk(deskId: string): void;
}

export function installAgentsPanel(ctx: Ctx, deps: AgentsPanelDeps) {
  let open: { close(): void } | undefined;
  const waiting = () => store.floors.reduce((n, f) => n + (f.waiting ?? 0), 0);

  function show() {
    if (open) return;
    const panel = openAgentsPanel({
      currentFloor: () => store.floor ?? undefined,
      openWorker: (a) => {
        if (a.floor === store.floor) return deps.openWorker(a.id);
        deps.switchFloor(a.floor);
        when(() => store.floor === a.floor && store.workers.has(a.id), () => deps.openWorker(a.id));
      },
      newTask: (floorId) => {
        const hire = () => {
          const seat = deps.firstFreeSeat();
          if (seat) deps.hireAtDesk(seat);
        };
        if (floorId === store.floor) return hire();
        deps.switchFloor(floorId);
        when(() => store.floor === floorId, () => window.setTimeout(hire, 400));
      },
      wake: (id) => ctx.net.send({ t: 'worker.resume', workerId: id }),
      sendHome: (id) => ctx.net.send({ t: 'worker.kill', workerId: id, cleanup: 'keep' }),
    });
    open = panel;
    // The panel closes itself (\u2715 or Esc); this hears it through the modal stack going quiet.
    const watch = window.setInterval(() => {
      if (!document.querySelector('.agents-room')) {
        open = undefined;
        window.clearInterval(watch);
      }
    }, 500);
  }

  addHudAction({
    id: 'agents',
    icon: '\u{1f6f0}\ufe0f',
    label: 'Agents',
    section: 'Open',
    count: waiting,
    tone: () => (waiting() ? 'danger' : undefined),
    title: () => 'Every agent on every floor in one place: what each is doing, message it, wake it, send it home',
    run: show,
  });
}
