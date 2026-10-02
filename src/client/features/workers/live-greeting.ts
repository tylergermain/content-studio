import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { h, modalOpen, toast } from '../../ui/dom';
import { chatRequest } from '../../ui/worker-chat/api';
import { WorkerLive } from '../../ui/worker-chat/live';
import type { ChatSnapshot } from '../../../shared/worker-chat';
import type { WorkerView } from './views';
import './live-greeting.css';

/** In-world voice keeps the office visible and gives the agent your attention. */
export function installLiveGreeting(ctx: Ctx, views: Map<string, WorkerView>) {
  const ray = new THREE.Raycaster();
  const point = new THREE.Vector3();
  let current: { id: string; floor: string | null; live: WorkerLive; panel: HTMLElement; rotation: number; yaw: number; polling: boolean; started: boolean } | undefined;
  function stop() {
    const c = current;
    if (!c) return;
    current = undefined;
    c.live.stop();
    c.panel.remove();
    const view = views.get(c.id);
    if (view) view.model.root.rotation.y = c.rotation;
  }
  function aimedWorker(): string | undefined {
    ray.setFromCamera(new THREE.Vector2(0, 0), ctx.camera);
    ray.far = 4.5;
    // Raycast the scene as well as the agent, so walls and desks block conversations.
    const hit = ray.intersectObjects(ctx.scene.children, true).find(h => {
      if (!(h.object instanceof THREE.Mesh)) return false;
      for (let object: THREE.Object3D | null = h.object; object; object = object.parent) if (!object.visible) return false;
      return true;
    });
    if (!hit) return;
    for (const [id, view] of views) {
      const worker = store.workers.get(id);
      if (worker?.kind !== 'agent' || view.model.walking) continue;
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (object === view.model.root) return id;
        object = object.parent;
      }
    }
  }
  async function refresh() {
    const c = current;
    if (!c || c.polling) return;
    c.polling = true;
    try {
      const snapshot = await chatRequest<ChatSnapshot>(c.id);
      if (current !== c) return;
      if (!snapshot.liveConfigured) {
        stop();
        toast('Add your OpenAI API key using Talk live in the agent’s chat first.', 'warn');
        return;
      }
      c.live.update(snapshot);
      if (!c.started) { c.started = true; await c.live.start(snapshot); }
      else if (!c.live.active) stop();
    } catch (error) {
      if (current === c) { stop(); toast(error instanceof Error ? error.message : 'Live chat could not connect', 'warn'); }
    } finally { c.polling = false; }
  }
  function start(id: string) {
    stop();
    const worker = store.workers.get(id), view = views.get(id);
    if (!worker || !view) return;
    const status = h('p', { 'aria-live': 'polite' }, 'Connecting…');
    const transcript = h('p.live-greeting-transcript', { 'aria-live': 'polite' });
    const mute = h('button.btn', { type: 'button' }, 'Mute mic');
    const listen = h('button.btn', { type: 'button' }, 'Listen');
    let muted = false;
    const close = h('button.btn', { type: 'button', 'aria-label': 'End live conversation' }, '✕ End');
    const panel = h('section.live-greeting', { 'aria-label': `Live conversation with ${worker.name}` }, h('strong', {}, `Talking with ${worker.name}`), status, transcript, close, mute, listen, h('small', {}, 'Q or Esc to end • OpenAI API billing while connected'));
    const live = new WorkerLive(id, text => {
      status.textContent = text;
      // Failed and disconnected sessions release the agent's attention.
      if (current?.live === live && (!live.active || /disconnected|connection failed/i.test(text))) {
        toast(text, 'warn');
        stop();
      }
    }, (role, text) => { transcript.textContent = `${role}: ${text}`; });
    current = { id, floor: store.floor, live, panel, rotation: view.model.root.rotation.y, yaw: view.model.root.rotation.y, polling: false, started: false };
    close.addEventListener('click', stop);
    mute.addEventListener('click', () => { muted = !muted; live.mute(muted); mute.textContent = muted ? 'Unmute mic' : 'Mute mic'; });
    listen.addEventListener('click', () => live.listen());
    document.body.append(panel);
    void refresh();
  }
  ctx.keys.add('activity', e => {
    if (e.code === 'Escape' && current) { stop(); return true; }
    if (e.code !== 'KeyQ' || modalOpen() || ctx.carrying() || ctx.activities.busy()) return false;
    const id = current?.id ?? aimedWorker();
    if (!id) return false;
    e.preventDefault();
    if (!e.repeat) { if (current) stop(); else start(id); }
    return true;
  });
  let pollAt = 0;
  ctx.ticks.add('world', ({ dt, now }) => {
    const c = current;
    if (!c) return;
    const view = views.get(c.id);
    if (!view || store.floor !== c.floor || modalOpen()) { stop(); return; }
    const root = view.model.root;
    root.getWorldPosition(point);
    if (point.distanceTo(ctx.player.pos) > 7) { stop(); return; }
    const target = root.parent ? root.parent.worldToLocal(ctx.player.pos.clone()) : ctx.player.pos;
    const yaw = Math.atan2(target.x - root.position.x, target.z - root.position.z);
    const delta = Math.atan2(Math.sin(yaw - c.yaw), Math.cos(yaw - c.yaw));
    c.yaw += delta * (1 - Math.exp(-dt * 8));
    root.rotation.y = c.yaw;
    if (now > pollAt) { pollAt = now + 2000; void refresh(); }
  });
  return { stop, start };
}
