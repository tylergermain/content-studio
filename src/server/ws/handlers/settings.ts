// ⚙️ Settings: team notifications, the worker limit, upgrades, the holiday theme, the office's prompts
// and default worker, and whether merged workers go home by themselves.
import path from 'node:path';
import { OPEN_CODE_MODEL_MAX } from '../../../shared/providers.js';
import { MAX_WORKER_LIMIT, parseWorkerLimit } from '../../machine.js';
import { isThemePick } from '../../../shared/theme.js';
import { PROMPTS, PROMPT_MAX, isPromptId } from '../../../shared/prompts.js';
import type { SettingsClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import type { HandlerMap, ViewPieces } from './types.js';

/** The floor's Services board: its own workers' web servers. */
export const servicesView: ViewPieces['services'] = (ctx, floor) => ctx.servicesState(floor);

export const settingsHandlers = {
  'notify.webhook'(ctx, c, msg) {
    const who = c.peer.name;
    // Everyone's workers, on every floor, get posted there: admins pick where.
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the team notifications');
    const url = str(msg.url, 4096).trim();
    const err = ctx.webhook.set(url, who);
    ctx.warn(c, err);
    if (!err) ctx.toastAll(url ? `📣 ${who} set up team notifications` : `${who} turned off team notifications`);
  },
  'notify.test'(ctx, c) {
    const who = c.peer.name;
    void ctx.webhook.test(who).then((err) => ctx.sendTo(c, { t: 'toast', text: err ?? '📣 Sent a test message', level: err ? 'warn' : 'info' }));
  },
  'machine.limit'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the worker limit');
    const limit = msg.limit === null ? undefined : parseWorkerLimit(msg.limit);
    if (msg.limit !== null && limit === undefined) return ctx.warn(c, `The worker limit is a whole number from 1 to ${MAX_WORKER_LIMIT}`);
    const err = ctx.machine.setLimit(limit, who);
    if (err) return ctx.warn(c, err);
    const now = ctx.machine.limit;
    ctx.toastAll(limit !== undefined ? `⚙️ ${who} set the worker limit to ${now}` : now === undefined ? `⚙️ ${who} took the worker limit off` : `⚙️ ${who} put the worker limit back to ${now} (--max-workers)`);
    ctx.pumpQueues();
  },
  'upgrade.check'(ctx) {
    void ctx.upgrader.check();
  },
  'upgrade.start'(ctx, c) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can upgrade the office');
    void ctx.upgrader.start(who).then((err) => {
      if (err) ctx.warn(c, err);
      else ctx.toastAll(`${who} is upgrading the office — it restarts when the new version is built`);
    });
  },
  'theme.set'(ctx, c, msg) {
    const who = c.peer.name;
    if (!isThemePick(msg.pick)) return;
    if (msg.pick === ctx.themes.state().pick) return;
    ctx.themes.set(msg.pick, who);
    const now = ctx.themes.state().active;
    ctx.toastAll(
      msg.pick === 'christmas'
        ? `🎄 ${who} dressed the office up for Christmas`
        : msg.pick === 'off'
          ? `${who} took the holiday decorations down`
          : `📅 ${who} set the decorations to follow the calendar${now ? " (it's Christmas 🎄 season)" : ''}`,
    );
  },
  'leaveOnMerge.set'(ctx, c, msg) {
    const who = c.peer.name;
    const on = msg.on === true;
    if (on === ctx.leaveOnMerge.on) return;
    ctx.leaveOnMerge.set(on, who);
    ctx.toastAll(on ? `🏠 ${who} set workers to go home by themselves once their pull request merges` : `🪑 ${who} set workers whose pull request merged to stay until they're sent home`);
    // The ones already merged go now.
    if (on) for (const f of ctx.floors.values()) f.sendLandedHome();
  },
  'prompts.set'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the office’s prompts');
    if (!isPromptId(msg.id) || (msg.text !== null && typeof msg.text !== 'string')) return;
    const custom = !!ctx.prompts.state().custom[msg.id];
    const err = ctx.prompts.setPrompt(msg.id, msg.text === null ? null : str(msg.text, PROMPT_MAX + 1), who);
    if (err) return ctx.warn(c, err);
    const now = !!ctx.prompts.state().custom[msg.id];
    const { label } = PROMPTS[msg.id];
    if (now) ctx.toastAll(`📝 ${who} rewrote the “${label}” prompt`);
    else if (custom) ctx.toastAll(`📝 ${who} put the default “${label}” prompt back`);
  },
  'prompts.agent'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can pick the office’s default worker');
    const ch = msg.choice;
    if (ch !== null && (!ch || typeof ch !== 'object')) return;
    const choice = ch && {
      provider: ch.provider,
      model: ch.model === undefined || ch.model === '' ? undefined : str(ch.model, OPEN_CODE_MODEL_MAX + 1),
      effort: ch.effort === undefined ? undefined : ch.effort,
    };
    const err = ctx.prompts.setAgent(choice, who);
    if (err) return ctx.warn(c, err);
    ctx.toastAll(choice ? `🤖 ${who} set the office’s default worker` : `🤖 ${who} put the office’s default worker back to ${path.basename(ctx.cfg.agentCmd)}`);
  },
} satisfies HandlerMap<SettingsClientMsg>;
