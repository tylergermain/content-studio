import { employeeWorkerError } from '../../org-chart/access.js';
import type { AgentsView } from '../../../shared/agents.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

// GET /api/agents (exactly: /api/agents/<provider>/models is agents.ts's): every worker on every floor for the Agents panel (shared/agents.ts), each with its floor, whether
// the viewer may direct it (as the chat's own routes decide, org-chart/access.ts), and the web servers it's running.

export const agentsPanelRoute = {
  method: 'GET',
  path: '/api/agents',
  auth: 'session',
  handle(ctx, { res, session }) {
    const account = session.account?.id;
    const services = ctx.services.list();
    const floors = [...ctx.floors.values()];
    const view: AgentsView = {
      floors: floors.map((f) => ({ id: f.id, name: f.def.name })),
      agents: floors.flatMap((f) => f.workers.list().map((w) => ({
        ...w,
        floor: f.id,
        floorName: f.def.name,
        canControl: !employeeWorkerError(ctx, f, account, w.id),
        apps: services.filter((s) => s.workerId === w.id).sort((a, b) => a.port - b.port).map((s) => ({ port: s.port, title: s.title || s.command })),
      }))),
    };
    return send(res, 200, view);
  },
} satisfies Route;
