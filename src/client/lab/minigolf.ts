// The Putt Street lab, for checking the course by eye (Vite dev only, it isn't built:
// http://localhost:5173/lab/minigolf.html). The course is built by the office's own code from the
// holes in shared/minigolf/course.ts, so what it shows is what the street shows. Query params:
//   hole=<1..9>        just that hole on its cell, close up; without it, the whole of Putt Street
//   view=<radians>     where the camera looks from, round it (0 looks from +z, from the street's side)
//   height=<m>         how high the camera is (default: a third of the way back)
//   dist=<m>           how far back the camera is (default: far enough to fit it)
//   t=<seconds>        the office's clock: where the windmill's sails are, drawn once (without it, they turn)
//   roll=<yaw>,<power> a putt from the hole's tee, rolled with the office's own physics (the page never
//                      does this; the lab does, to check the drawing lines up with what the ball does):
//                      its path as a line, and the ball `at` seconds along it
//   at=<seconds>       how far along the putt the ball is drawn (default: where it stops)
// Once it has drawn, window.__ready holds the hole's size, triangles and draw calls, and the putt's.

import * as THREE from 'three';
import { HOLES } from '../../shared/minigolf/course';
import { roll, teeBall } from '../../shared/minigolf/physics';
import { BALL_R } from '../../shared/minigolf/types';
import { pathAt, rollSeconds } from '../features/minigolf/play';
import { buildPuttStreet } from '../features/minigolf/world';
import { buildHole } from '../world/minigolf/hole';
import { mergeByMaterial, mesh, toon } from '../world/toon';
import { ready, stage } from './stage';

const q = new URLSearchParams(location.search);
const n = q.has('hole') ? Math.min(9, Math.max(1, Number(q.get('hole')))) : null;
const officeMs = Number(q.get('t') ?? 0.3) * 1000;
const { scene, camera, renderer, render, sun } = stage(document.getElementById('c') as HTMLCanvasElement);

const statics = new THREE.Group();
const buildStart = performance.now();
const view = n ? buildHole(HOLES[n - 1], statics) : buildPuttStreet(null);
if (n) view.group.add(mergeByMaterial(statics));
const buildMs = Math.round(performance.now() - buildStart);
scene.add(view.group);
view.update(officeMs);
const box = new THREE.Box3().setFromObject(view.group);
const middle = n ? new THREE.Vector3(HOLES[n - 1].cell.x, 0.4, HOLES[n - 1].cell.z) : box.getCenter(new THREE.Vector3());
const extent = n ? new THREE.Vector3(10, 3, 10) : box.getSize(new THREE.Vector3());
// The lab's sun lights a few meters round the middle: here, the hole's cell or the whole course.
sun.position.set(middle.x - 8, 18, middle.z + 10);
sun.target.position.copy(middle);
scene.add(sun.target);
Object.assign(sun.shadow.camera, { left: -extent.x * 0.7, right: extent.x * 0.7, top: extent.z * 0.7, bottom: -extent.z * 0.7, far: 120 });
sun.shadow.camera.updateProjectionMatrix();

// A putt from the tee, if asked for: its path, and the ball somewhere along it.
const facts: Record<string, unknown> = {};
if (n && q.has('roll')) {
  const [yaw, power] = (q.get('roll') ?? '0,0.3').split(',').map(Number);
  const hole = HOLES[n - 1];
  const rolled = roll(hole, { from: teeBall(hole), yaw, power, startAt: officeMs });
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < rolled.path.length; i += 3) pts.push(new THREE.Vector3(rolled.path[i], rolled.path[i + 1] + BALL_R, rolled.path[i + 2]));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ef476f' })));
  const at = q.has('at') ? Number(q.get('at')) : rollSeconds(rolled.path);
  const ball = mesh(new THREE.SphereGeometry(BALL_R, 16, 12), toon('#ffd166'));
  pathAt(rolled.path, at, ball.position).y += BALL_R;
  scene.add(ball);
  // The sails where they are when the ball is there.
  view.update(officeMs + at * 1000);
  Object.assign(facts, { seconds: +rollSeconds(rolled.path).toFixed(2), holed: rolled.holed, out: rolled.out, moved: rolled.moved, rest: rolled.rest, events: rolled.events });
}

const turn = Number(q.get('view') ?? (n ? 0.5 : 0.35));
const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
const fit = (Math.max(extent.x, extent.z) / 2 / (tan * Math.min(1, camera.aspect))) * 1.05;
const d = q.has('dist') ? Number(q.get('dist')) : fit;
const up = q.has('height') ? Number(q.get('height')) : d * 0.45;
camera.position.set(middle.x + Math.sin(turn) * d, middle.y + up, middle.z + Math.cos(turn) * d);
camera.far = 400;
camera.lookAt(middle);
camera.updateProjectionMatrix();
render();
// Without a time asked for, the windmill turns (on this page's clock).
if (!q.has('t') && !q.has('roll')) {
  const frame = (now: number) => {
    view.update(now);
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

let tris = 0;
let draws = 0;
view.group.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  draws++;
  tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
});
document.getElementById('info')!.textContent = n ? `${n} · ${HOLES[n - 1].name} · par ${HOLES[n - 1].par}` : 'Putt Street';
ready({ size: box.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)), tris, draws, calls: renderer.info.render.calls, buildMs, ...facts });
