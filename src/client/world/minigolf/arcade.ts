import * as THREE from 'three';
import { mesh, textPlane, toon, toonUnique } from '../toon';
import type { Hole } from '../../../shared/minigolf/types';
import { heightAt } from '../../../shared/minigolf/physics';

/** A mown checker pattern in world coordinates, without textures or extra course draw calls. */
export function arcadeFelt(color: string): THREE.MeshToonMaterial {
  const material = toonUnique(color);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec2 courseXZ;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncourseXZ = position.xz;');
    shader.fragmentShader = 'varying vec2 courseXZ;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat square = mod(floor(courseXZ.x / 0.8) + floor(courseXZ.y / 0.8), 2.0);\ndiffuseColor.rgb *= mix(0.90, 1.08, square);');
  };
  material.customProgramCacheKey = () => 'putt-checker-v1';
  return material;
}

/** A numbered pin makes the target readable from the chase camera and overview. Cosmetic only. */
export function cupFlag(hole: Hole): THREE.Group {
  const group = new THREE.Group();
  const y = heightAt(hole, hole.cup.x, hole.cup.z) ?? 0;
  group.position.set(hole.cup.x, y, hole.cup.z);
  group.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 8), toon('#fffaf3'), 0, 0.55, 0, false));
  const flag = textPlane(String(hole.n), { bg: '#ffb347', color: '#172d36', size: 48 });
  flag.scale.set(0.5, 0.5, 0.5);
  flag.position.set(0.2, 0.95, 0); group.add(flag);
  const back = flag.clone(); back.rotation.y = Math.PI; back.position.z = -0.002; group.add(back);
  return group;
}
