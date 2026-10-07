import * as THREE from 'three';

// The toon outline: three's OutlineEffect (examples/jsm/effects/OutlineEffect.js, MIT), redone to cost less a
// frame and draw exactly the same. The scene is drawn as it is, then drawn again with each mesh in a copy of its
// material turned inside out and pushed out a little, in the outline's color: what shows round its edges is the
// line. Three's walks the whole scene twice a frame (to put the outline materials on, and to take them off again),
// keeps them all in dictionaries by uuid and tidies those every frame. This swaps only what the scene's own
// render just drew (three's render list: shown, in view, in the camera's layers, so never a batched mesh,
// world/batch), puts back exactly what it swapped from a list, keeps the copies by the material they're of,
// and tidies once a second.
// The shaders and how each copy follows its material are three's own.

const VERTEX = [
  '#include <common>',
  '#include <uv_pars_vertex>',
  '#include <displacementmap_pars_vertex>',
  '#include <fog_pars_vertex>',
  '#include <morphtarget_pars_vertex>',
  '#include <skinning_pars_vertex>',
  '#include <logdepthbuf_pars_vertex>',
  '#include <clipping_planes_pars_vertex>',
  'uniform float outlineThickness;',
  'vec4 calculateOutline( vec4 pos, vec3 normal, vec4 skinned ) {',
  '	float thickness = outlineThickness;',
  '	const float ratio = 1.0;',
  '	vec4 pos2 = projectionMatrix * modelViewMatrix * vec4( skinned.xyz + normal, 1.0 );',
  '	vec4 norm = normalize( pos - pos2 );',
  '	return pos + norm * thickness * pos.w * ratio;',
  '}',
  'void main() {',
  '	#include <uv_vertex>',
  '	#include <beginnormal_vertex>',
  '	#include <morphnormal_vertex>',
  '	#include <skinbase_vertex>',
  '	#include <skinnormal_vertex>',
  '	#include <begin_vertex>',
  '	#include <morphtarget_vertex>',
  '	#include <skinning_vertex>',
  '	#include <displacementmap_vertex>',
  '	#include <project_vertex>',
  '	vec3 outlineNormal = - objectNormal;',
  '	gl_Position = calculateOutline( gl_Position, outlineNormal, vec4( transformed, 1.0 ) );',
  '	#include <logdepthbuf_vertex>',
  '	#include <clipping_planes_vertex>',
  '	#include <fog_vertex>',
  '}',
].join('\n');

const FRAGMENT = [
  '#include <common>',
  '#include <fog_pars_fragment>',
  '#include <logdepthbuf_pars_fragment>',
  '#include <clipping_planes_pars_fragment>',
  'uniform vec3 outlineColor;',
  'uniform float outlineAlpha;',
  'void main() {',
  '	#include <clipping_planes_fragment>',
  '	#include <logdepthbuf_fragment>',
  '	gl_FragColor = vec4( outlineColor, outlineAlpha );',
  '	#include <tonemapping_fragment>',
  '	#include <colorspace_fragment>',
  '	#include <fog_fragment>',
  '	#include <premultiplied_alpha_fragment>',
  '}',
].join('\n');

/** How each material says how its outline goes (three's convention): `{ visible: false }` for none. */
interface OutlineParameters {
  thickness?: number;
  color?: number[];
  alpha?: number;
  visible?: boolean;
  keepAlive?: boolean;
}

/** A material's outline copy, and how long it's gone unused. */
interface Kept {
  material: THREE.ShaderMaterial;
  used: boolean;
  keepAlive: boolean;
  idle: number;
}

/** How often the copies nobody's used are tidied away (frames), and how many tidies unused before one goes. */
const TIDY_EVERY = 60;
const TIDY_AFTER = 2;

type AnyMaterial = THREE.Material & { displacementMap?: THREE.Texture | null; displacementScale?: number; displacementBias?: number; wireframe?: boolean };

export class FastOutlineEffect {
  enabled = true;
  /**
   * Whether drawing through it clears the frame first: no, as three's (which never sets it, so it's undefined).
   * The office's scene clears itself with its sky color; your hands are drawn over it, and mustn't.
   */
  autoClear = false;
  private readonly kept = new Map<THREE.Material, Kept>();
  private readonly defaults: { thickness: number; color: THREE.Color; alpha: number; keepAlive: boolean };
  /** This frame's swaps, to put back: each mesh, its own material (or materials) and its own onBeforeRender. */
  private readonly swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[]; before: THREE.Object3D['onBeforeRender'] }[] = [];
  private frames = 0;
  /** Which outline pass this is, to swap each mesh once in it. */
  private swapRound = 0;
  /** Every outline copy's onBeforeRender: its uniforms from the material it's a copy of, as three's does. */
  private readonly beforeRender = (_r: THREE.WebGLRenderer, _s: THREE.Scene, _c: THREE.Camera, _g: THREE.BufferGeometry, material: THREE.Material) => {
    const original = material.userData.outlineOf as AnyMaterial | undefined;
    if (original) this.uniformsFrom(material as THREE.ShaderMaterial, original);
  };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    o: { defaultThickness?: number; defaultColor?: number[]; defaultAlpha?: number; defaultKeepAlive?: boolean } = {},
  ) {
    this.defaults = { thickness: o.defaultThickness ?? 0.003, color: new THREE.Color().fromArray(o.defaultColor ?? [0, 0, 0]), alpha: o.defaultAlpha ?? 1, keepAlive: o.defaultKeepAlive ?? false };
  }

  /** Draws the scene, and its outline over it. */
  render(scene: THREE.Object3D, camera: THREE.Camera) {
    if (!this.enabled) return void this.renderer.render(scene, camera);
    const was = this.renderer.autoClear;
    this.renderer.autoClear = this.autoClear;
    this.renderer.render(scene, camera);
    this.renderer.autoClear = was;
    this.renderOutline(scene, camera);
  }

  /** Draws the outline of what's in the scene, over what's already drawn. */
  renderOutline(scene: THREE.Object3D, camera: THREE.Camera) {
    const r = this.renderer;
    const s = scene as THREE.Scene;
    const was = { clear: r.autoClear, matrices: s.matrixWorldAutoUpdate, background: s.background, shadows: r.shadowMap.enabled };
    s.matrixWorldAutoUpdate = false;
    s.background = null;
    r.autoClear = false;
    r.shadowMap.enabled = false;
    // What the scene's own render just drew is what the outline pass would draw: swap only those, if it has a list of them.
    if (!this.swapDrawn(scene)) this.swapIn(scene, camera.layers);
    r.render(scene, camera);
    for (const w of this.swapped) {
      w.mesh.material = w.material;
      w.mesh.onBeforeRender = w.before;
    }
    this.swapped.length = 0;
    if (++this.frames % TIDY_EVERY === 0) this.tidy();
    s.matrixWorldAutoUpdate = was.matrices;
    s.background = was.background;
    r.autoClear = was.clear;
    r.shadowMap.enabled = was.shadows;
  }

  /**
   * Puts the outline copies on the meshes the scene's own render just drew (three's render list for it): the
   * ones that are shown, in view and in this camera's layers, which are all the outline pass would draw too.
   * False when there's no such list (nothing drawn yet), for swapIn to walk the scene instead.
   */
  private swapDrawn(scene: THREE.Object3D): boolean {
    const list = this.renderer.renderLists.get(scene as THREE.Scene, 0) as unknown as { opaque: { object: THREE.Object3D }[]; transmissive: { object: THREE.Object3D }[]; transparent: { object: THREE.Object3D }[] };
    if (!list.opaque.length && !list.transparent.length && !list.transmissive.length) return false;
    const frame = ++this.swapRound;
    for (const items of [list.opaque, list.transmissive, list.transparent]) {
      for (const item of items) {
        const m = item.object as THREE.Mesh & { __outlineRound?: number };
        // Once a mesh: one with materials for parts is in the list once a part.
        if (m.__outlineRound === frame || !m.isMesh || !m.material || !m.geometry?.attributes?.normal) continue;
        m.__outlineRound = frame;
        this.swap(m);
      }
    }
    return true;
  }

  private swap(m: THREE.Mesh) {
    const material = m.material;
    this.swapped.push({ mesh: m, material: Array.isArray(material) ? [...material] : material, before: m.onBeforeRender });
    m.material = Array.isArray(material) ? material.map((x) => this.outlineOf(x)) : this.outlineOf(material);
    m.onBeforeRender = this.beforeRender;
  }

  /** Puts the outline copies on everything under `o` that's shown and that this camera draws (three draws nothing else). */
  private swapIn(o: THREE.Object3D, layers: THREE.Layers) {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material && m.geometry?.attributes?.normal && o.layers.test(layers)) this.swap(m);
    const kids = o.children;
    for (let i = 0; i < kids.length; i++) this.swapIn(kids[i], layers);
  }

  /** Material `original`'s outline copy, made the first time and brought up to date with it every time. */
  private outlineOf(original: AnyMaterial): THREE.ShaderMaterial {
    let k = this.kept.get(original);
    if (!k) {
      const material = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, THREE.UniformsLib.displacementmap, { outlineThickness: { value: this.defaults.thickness }, outlineColor: { value: this.defaults.color }, outlineAlpha: { value: this.defaults.alpha } }]),
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        side: THREE.BackSide,
      });
      (material as { type: string }).type = 'OutlineEffect';
      this.kept.set(original, (k = { material, used: true, keepAlive: this.defaults.keepAlive, idle: 0 }));
    }
    k.used = true;
    const material = k.material;
    material.userData.outlineOf = original;
    // As three's updateOutlineMaterial.
    const p = original.userData.outlineParameters as OutlineParameters | undefined;
    material.fog = (original as { fog?: boolean }).fog ?? false;
    material.toneMapped = original.toneMapped;
    material.premultipliedAlpha = original.premultipliedAlpha;
    (material as AnyMaterial).displacementMap = original.displacementMap ?? null;
    if (p) {
      material.visible = original.visible === false ? false : (p.visible ?? true);
      material.transparent = p.alpha !== undefined && p.alpha < 1 ? true : original.transparent;
      if (p.keepAlive !== undefined) k.keepAlive = p.keepAlive;
    } else {
      material.transparent = original.transparent;
      material.visible = original.visible;
    }
    if (original.wireframe === true || original.depthTest === false) material.visible = false;
    if (original.clippingPlanes) {
      material.clipping = true;
      material.clippingPlanes = original.clippingPlanes;
      material.clipIntersection = original.clipIntersection;
      material.clipShadows = original.clipShadows;
    }
    // Brought up to date (its program made again) when the material it's of is.
    (material as { version: number }).version = original.version;
    return material;
  }

  private uniformsFrom(material: THREE.ShaderMaterial, original: AnyMaterial) {
    const u = material.uniforms;
    const p = original.userData.outlineParameters as OutlineParameters | undefined;
    u.outlineAlpha.value = original.opacity;
    if (p) {
      if (p.thickness !== undefined) u.outlineThickness.value = p.thickness;
      if (p.color !== undefined) (u.outlineColor.value as THREE.Color).fromArray(p.color);
      if (p.alpha !== undefined) u.outlineAlpha.value = p.alpha;
    }
    if (original.displacementMap) {
      u.displacementMap.value = original.displacementMap;
      u.displacementScale.value = original.displacementScale;
      u.displacementBias.value = original.displacementBias;
    }
  }

  /** The copies of materials nothing's been drawn with for a while go (unless they're to be kept). */
  private tidy() {
    for (const [original, k] of this.kept) {
      if (k.used) {
        k.used = false;
        k.idle = 0;
      } else if (!k.keepAlive && ++k.idle >= TIDY_AFTER) {
        k.material.dispose();
        this.kept.delete(original);
      }
    }
  }
}
