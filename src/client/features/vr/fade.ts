/**
 * The lights going down in the elevator (#fade, see core/travel.ts), in VR: the page's fade can't
 * be seen in a headset, so a sphere round your head darkens with it, at the same pace (hud.css:
 * .3 s, or .16 s when it's quick). The panels still show over it, as windows do over #fade.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { noOutline } from '../../core/outline';
import type { VrSession } from './types';

/** #fade's color (hud.css). */
const DARK = '#1b1d2e';
/** How long the fade takes, in seconds, as hud.css has it. */
const SLOW = 0.3;
const QUICK = 0.16;

export function startFade(ctx: Ctx, s: VrSession): void {
  const el = document.getElementById('fade');
  if (!el) return;
  const geometry = new THREE.SphereGeometry(0.4, 16, 12);
  const material = new THREE.MeshBasicMaterial({ color: DARK, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  const sphere = new THREE.Mesh(geometry, material);
  sphere.name = 'vr-fade';
  sphere.frustumCulled = false;
  // Over the world and the vignette, under the panels (1000 on).
  sphere.renderOrder = 990;
  sphere.visible = false;
  noOutline(sphere);
  ctx.scene.add(sphere);

  s.tick('hud', ({ dt }) => {
    const on = el.classList.contains('on');
    const pace = dt / (el.classList.contains('quick') ? QUICK : SLOW);
    material.opacity = THREE.MathUtils.clamp(material.opacity + (on ? pace : -pace), 0, 1);
    sphere.visible = material.opacity > 0;
    sphere.position.copy(s.head.position);
  });

  s.onEnd(() => {
    sphere.removeFromParent();
    geometry.dispose();
    material.dispose();
  });
}
