/**
 * The floor's apps (☰ › Apps): the tools a worker's window has beside the conversation (shared/apps.ts),
 * each with a checkmark. An admin turns them on and off for the floor; nothing is installed, and a
 * worker's window shows only the ones that are on. Anyone can open it to see which are.
 */
import './ui.css';
import { APPS, appOn } from '../../../shared/apps';
import type { WorkspaceTab } from '../../../shared/workspace';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { h, openModal } from '../../ui/dom';
import { addHudAction } from '../../ui/menu';

export function installApps(ctx: Ctx) {
  function openApps() {
    const admin = store.me.admin;
    const setup = store.studio.setup;
    const boxes = new Map<WorkspaceTab, HTMLInputElement>();
    const rows = APPS.map((a) => {
      const box = h('input', { type: 'checkbox', disabled: !admin || !!a.always }) as HTMLInputElement;
      box.checked = appOn(setup, a.tab);
      boxes.set(a.tab, box);
      return h('label.apps-row', { class: box.disabled ? 'locked' : '' }, box, h('span.apps-icon', {}, a.icon), h('span.apps-text', {}, h('strong', {}, a.name), h('span', {}, a.about)));
    });
    const save = h('button.btn.primary', { type: 'button', disabled: !admin }, 'Save for this floor');
    const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
    const el = h(
      'div.modal.apps-window',
      { role: 'dialog', 'aria-label': 'Apps' },
      h('header', {}, h('h2', {}, `🧩 Apps on ${store.currentFloor()?.name ?? 'this floor'}`), close),
      h('div.body', {}, h('p.apps-note', {}, 'The tools beside the conversation in a worker’s window. Check the ones this floor uses; a worker’s window shows only those, each when there’s something for it (a design, a cut, a report).'), ...rows),
      h('footer', {}, h('span.grow', {}, admin ? 'Applies to everyone on this floor' : 'Only an admin changes a floor’s apps'), save),
    );
    const modal = openModal(el, { doing: '🧩 looking at the apps' });
    close.addEventListener('click', () => modal.close());
    save.addEventListener('click', () => {
      const off = [...boxes].filter(([, b]) => !b.checked && !b.disabled).map(([tab]) => tab);
      ctx.net.send({ t: 'studio.apps', off });
      modal.close();
    });
  }

  addHudAction({
    id: 'apps',
    icon: '🧩',
    label: 'Apps',
    section: 'Office',
    shown: () => !!store.floor,
    title: () => (store.me.admin ? 'Turn this floor’s apps on and off: the design canvas, the screening room and the rest' : 'See which apps this floor has on'),
    run: openApps,
  });
}
