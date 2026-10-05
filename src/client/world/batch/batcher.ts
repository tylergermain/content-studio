/**
 * Static batching: the meshes of the office that never move or change, drawn a region and a kind at a
 * time as merged meshes (see plan.ts for which and with what, merge.ts for the merging). It's what turns
 * a floor's two or three thousand draw calls into a couple of hundred, for the Quest (see
 * features/vr/quality.ts, which turns it on).
 *
 * Nothing else in the office has to know. A batched mesh stays where it was, as it was: what picks
 * things with a ray (E, the VR trigger, the builder) still finds it, and anything that moves it, hides
 * it or swaps its material still can. It's only the cameras that draw the office that pass it by: its
 * layers say no to any with the DRAWN layer on (see Unseen), and every camera that draws the office
 * has it, the headset's eyes included (three gives them the camera's layers). The merged meshes are
 * drawn instead, and no ray ever lands on one.
 *
 * Whether a mesh never moves or changes is found out by watching it. After a floor's world is built,
 * and whenever its layout, furniture, room or floor change (`version`), the batcher watches every mesh
 * that could be batched for a little while (WARM_MS), and batches those that kept still, a few batches
 * a frame, once the shaders of the plain batches' own materials are compiled (BatcherDeps.warm), so
 * none stalls on its shader as it's first drawn. From then on, once a frame just before the office is
 * drawn, it checks every batched mesh is where it was, as it was: one that's moved, hidden or changed
 * draws itself again from that frame on, and its batch is merged again without it. When much changes
 * at once it starts over.
 */
import * as THREE from 'three';
import { materialFacts, meshFacts, type AnyMaterial } from './facts';
import { materialKind, meshVeto, planBatches, regionKey, type PartPlan } from './plan';
import { mergeParts, plainMaterial, probeOf, rangeOf, type MergePart } from './merge';

export { materialFacts, meshFacts };

/** The layer every camera that draws the office has on while batching is: a batched mesh's layers turn it away. */
export const DRAWN = 30;
const DRAWN_BIT = 1 << DRAWN;

/** A batched mesh's layers: as they were for anything that asks (a raycaster), but not for a camera that draws the office. */
class Unseen extends THREE.Layers {
  constructor(readonly was: THREE.Layers) {
    super();
    this.mask = was.mask;
  }
  override test(layers: THREE.Layers): boolean {
    return (layers.mask & DRAWN_BIT) === 0 && super.test(layers);
  }
}

/** How long the meshes are watched before any is batched, and for at least how many frames. */
const WARM_MS = 1500;
const WARM_FRAMES = 20;
/** How long building batches may take of a frame (at least one is built each frame). */
const BUILD_MS = 4;
/** More batched meshes than this changing at once, and it all starts over. */
const TOO_MANY = 24;
/** The longest the batches wait for their shaders (BatcherDeps.warm) before they're built anyway. */
const WARM_WAIT_MS = 5000;

/** A mesh that could be batched, and how it was when first seen. */
interface Seen {
  mesh: THREE.Mesh;
  root: number;
  parts: PartPlan[];
  matrix: Float64Array;
  material: THREE.Material | THREE.Material[];
  geometry: THREE.BufferGeometry;
  versions: Float64Array;
  parent: THREE.Object3D;
  cast: boolean;
  receive: boolean;
  /** The groups and other nodes over it, as indices into Batcher.nodes. */
  chain: number[];
  /** The batches it's drawn in, once it is. */
  batches?: Set<string>;
}

/** A node over a watched mesh: as it was, to see whether it's been hidden or taken out. */
interface Node {
  node: THREE.Object3D;
  visible: boolean;
  parent: THREE.Object3D | null;
}

/** A material batched meshes are drawn with, as it was when they were batched: whatever would make a merged one draw differently. */
interface MatRecord {
  users: Set<Seen>;
  /** Kept in a plain batch's vertices (its colour), or in the copy of it the batch is drawn with (the rest). */
  plain: boolean;
  color: THREE.Color | null;
  emissive: THREE.Color | null;
  emissiveIntensity: number;
  map: THREE.Texture | null;
  visible: boolean;
  transparent: boolean;
  side: number;
  version: number;
}

const recordOf = (m: AnyMaterial, plain: boolean): MatRecord => ({
  users: new Set(),
  plain,
  color: m.color?.clone() ?? null,
  emissive: m.emissive?.clone() ?? null,
  emissiveIntensity: m.emissiveIntensity ?? 1,
  map: m.map ?? null,
  visible: m.visible,
  transparent: m.transparent,
  side: m.side,
  version: m.version,
});

const sameColor = (a: THREE.Color | undefined, b: THREE.Color | null) => (!a && !b) || (!!a && !!b && a.equals(b));

/** Whether material `m` still draws as it did when it was recorded. */
function stillAs(m: AnyMaterial, r: MatRecord): boolean {
  if (m.visible !== r.visible || m.transparent !== r.transparent || m.side !== r.side) return false;
  if (!r.plain) return true;
  return m.version === r.version && (m.map ?? null) === r.map && (m.emissiveIntensity ?? 1) === r.emissiveIntensity && sameColor(m.color, r.color) && sameColor(m.emissive, r.emissive);
}

/** One merged mesh. */
interface Batch {
  key: string;
  root: number;
  mesh: THREE.Mesh;
  members: Seen[];
  plans: PartPlan[];
}

/** What says a geometry's been changed in place: its attributes' and index's versions, its draw range and its groups. */
const VERSIONS = 8;
const versionOf = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined) => (!a ? -1 : (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data.version : (a as THREE.BufferAttribute).version);
function versionsInto(g: THREE.BufferGeometry, out: Float64Array, at = 0): Float64Array {
  const a = g.attributes;
  out[at] = versionOf(a.position);
  out[at + 1] = versionOf(a.normal);
  out[at + 2] = versionOf(a.uv);
  out[at + 3] = versionOf(a.color);
  out[at + 4] = g.index?.version ?? -1;
  out[at + 5] = g.drawRange.start;
  out[at + 6] = g.drawRange.count;
  out[at + 7] = g.groups.length;
  return out;
}
const scratch = new Float64Array(VERSIONS);

/** Whether two materials (or lists of them) are the same ones. */
const sameMaterial = (a: THREE.Material | THREE.Material[], b: THREE.Material | THREE.Material[]) =>
  a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((m, i) => m === b[i]));

export interface BatcherStats {
  state: 'off' | 'watching' | 'warming' | 'building' | 'ready';
  /** Meshes watched (could be batched), batched, and found to move or change. */
  watched: number;
  batched: number;
  moving: number;
  batches: number;
  /** How many times it started over, and merged a batch again. */
  resets: number;
  rebuilds: number;
  /** The meshes the last look passed over, by why. */
  passed: Record<string, number>;
}

export interface BatcherDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** What to batch in: the office's group (and the roof's, once there is one). */
  roots(): THREE.Object3D[];
  /** Changes whenever what's built may have: a floor's layout, furniture, room, the floor itself. */
  version(): string;
  /** While this says so (the builder's open), nothing is batched. */
  paused(): boolean;
  /** Compiles the shaders of what's under `probes` (the renderer's compileAsync), so a batch doesn't stall on its own as it's first drawn. */
  warm?(probes: THREE.Object3D): Promise<unknown>;
  now?(): number;
}

export class Batcher {
  private on = false;
  private state: BatcherStats['state'] = 'off';
  private seen: Seen[] = [];
  private nodes: Node[] = [];
  private moving = new WeakSet<THREE.Mesh>();
  private movingCount = 0;
  private batches = new Map<string, Batch>();
  private queue: string[] = [];
  private plan = new Map<string, PartPlan[]>();
  private containers: THREE.Group[] = [];
  private plainMats = new Map<string, THREE.Material>();
  /** The plain kinds whose materials have been warmed, and which watching this is (a warm-up from an older one is let be). */
  private warmed = new Set<string>();
  private round = 0;
  private since = 0;
  private frames = 0;
  private version = '';
  private checkedFrame = -1;
  private frameNo = 0;
  private resets = 0;
  private rebuilds = 0;
  private hook: THREE.Object3D['onBeforeRender'] | null = null;
  private mats = new Map<THREE.Material, MatRecord>();
  private nodeOk = new Uint8Array(0);

  constructor(private readonly deps: BatcherDeps) {}

  private now() {
    return this.deps.now?.() ?? performance.now();
  }

  /** Batching on or off: off, every mesh draws itself again and the merged ones are let go of. */
  enable(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    const { scene, camera } = this.deps;
    if (on) {
      camera.layers.enable(DRAWN);
      const was = scene.onBeforeRender;
      this.hook = was;
      scene.onBeforeRender = (...a) => {
        was.apply(scene, a);
        this.check();
      };
      this.version = this.deps.paused() ? 'paused' : this.deps.version();
      this.start();
    } else {
      this.drop();
      for (const c of this.containers) c.removeFromParent();
      this.containers = [];
      this.state = 'off';
      camera.layers.disable(DRAWN);
      if (this.hook) scene.onBeforeRender = this.hook;
      this.hook = null;
      for (const m of this.plainMats.values()) m.dispose();
      this.plainMats.clear();
      this.warmed.clear();
      this.round++;
    }
  }

  get enabled() {
    return this.on;
  }

  stats(): BatcherStats {
    let batched = 0;
    for (const s of this.seen) if (s.batches?.size) batched++;
    return { state: this.state, watched: this.seen.length, batched, moving: this.movingCount, batches: this.batches.size, resets: this.resets, rebuilds: this.rebuilds, passed: Object.fromEntries(this.vetoes) };
  }

  /** Once a frame, before the office's own (the 'pre' tick): starting over when it should, and building what's due. */
  frame() {
    this.frameNo++;
    if (!this.on) return;
    const paused = this.deps.paused();
    const version = paused ? 'paused' : this.deps.version();
    if (version !== this.version) {
      this.version = version;
      this.start();
    }
    if (paused) return;
    this.mirrorRoots();
    if (this.state === 'watching' && this.frames >= WARM_FRAMES && this.now() - this.since >= WARM_MS) this.planAll();
    if (this.state === 'building') this.buildSome();
  }

  /** Drops every batch and watches afresh. */
  private start() {
    this.drop();
    this.round++;
    this.moving = new WeakSet();
    this.movingCount = 0;
    this.resets++;
    if (this.deps.paused()) {
      this.state = 'watching';
      this.seen = [];
      this.nodes = [];
      this.frames = 0;
      this.since = Infinity;
      return;
    }
    this.scan();
    this.state = 'watching';
    this.frames = 0;
    this.since = this.now();
  }

  /** Every batched mesh draws itself again, and the batches go (their containers stay in the scene while batching's on). */
  private drop() {
    for (const b of this.batches.values()) this.free(b);
    this.batches.clear();
    for (const s of this.seen) this.unhide(s);
    this.queue = [];
    this.plan.clear();
    this.mats.clear();
  }

  /** The containers the batches of each root hang in: shown while it is, wherever it is. */
  private mirrorRoots() {
    const roots = this.deps.roots();
    roots.forEach((root, i) => {
      const c = this.containers[i];
      if (!c) return;
      let shown = true;
      for (let o: THREE.Object3D | null = root; o; o = o.parent) shown &&= o.visible;
      c.visible = shown;
    });
  }

  private container(i: number): THREE.Group {
    let c = this.containers[i];
    if (!c) {
      c = new THREE.Group();
      c.name = 'batches';
      c.matrixAutoUpdate = false;
      this.containers[i] = c;
    }
    if (!c.parent) this.deps.scene.add(c);
    return c;
  }

  /** Every mesh under the roots that could be batched, as it is now. */
  private scan() {
    this.seen = [];
    this.nodes = [];
    this.vetoes.clear();
    const nodeIndex = new Map<THREE.Object3D, number>();
    const containers = new Set<THREE.Object3D>(this.containers);
    const sphere = new THREE.Sphere();
    this.deps.roots().forEach((root, r) => {
      root.updateMatrixWorld(true);
      const walk = (o: THREE.Object3D, chain: number[], kept: boolean, groupOrder: number) => {
        if (!o.visible || containers.has(o)) return;
        kept ||= o.userData.noBatch === true;
        if ((o as THREE.Group).isGroup) groupOrder = o.renderOrder;
        const m = o as THREE.Mesh;
        if (m.isMesh) this.consider(m, r, chain, kept, groupOrder, sphere);
        if (!o.children.length) return;
        let i = nodeIndex.get(o);
        if (i === undefined) {
          i = this.nodes.length;
          nodeIndex.set(o, i);
          this.nodes.push({ node: o, visible: o.visible, parent: o.parent });
        }
        const next = [...chain, i];
        for (const c of o.children) walk(c, next, kept, groupOrder);
      };
      walk(root, [], false, 0);
    });
  }

  /** Why the meshes the last scan passed over weren't batched, and how many of each. */
  private vetoes = new Map<string, number>();

  private veto(why: string) {
    this.vetoes.set(why, (this.vetoes.get(why) ?? 0) + 1);
  }

  private consider(m: THREE.Mesh, root: number, chain: number[], kept: boolean, groupOrder: number, sphere: THREE.Sphere) {
    const facts = meshFacts(m, kept, groupOrder);
    const no = meshVeto(facts);
    if (no) return this.veto(no);
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    sphere.copy(g.boundingSphere!).applyMatrix4(m.matrixWorld);
    const region = regionKey(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const groups = Array.isArray(m.material) ? g.groups.map((gr, i) => [i, gr.materialIndex ?? 0] as const) : [[-1, 0] as const];
    if (!groups.length) return;
    const parts: PartPlan[] = [];
    for (const [group, mi] of groups) {
      const mat = mats[mi] as AnyMaterial | undefined;
      if (!mat) return this.veto('no material');
      const mf = materialFacts(mat);
      const kind = materialKind(mf);
      if (!kind) return this.veto(mf.transparent ? 'see-through' : 'drawn in a way of its own');
      parts.push({
        mesh: this.seen.length,
        group,
        kind,
        needsUv: mf.textured,
        hasUv: facts.uvs,
        colored: !kind.plain && mf.vertexColors && facts.colors,
        castShadow: m.castShadow,
        receiveShadow: m.receiveShadow,
        region,
      });
      // A material that colours by its vertices needs every part to have them.
      if (!kind.plain && mf.vertexColors && !facts.colors) return this.veto('no vertex colours');
    }
    this.seen.push({
      mesh: m,
      root,
      parts,
      matrix: Float64Array.from(m.matrixWorld.elements),
      material: Array.isArray(m.material) ? [...m.material] : m.material,
      geometry: g,
      versions: versionsInto(g, new Float64Array(VERSIONS)),
      parent: m.parent!,
      cast: m.castShadow,
      receive: m.receiveShadow,
      chain,
    });
  }

  /** The watching's over: what kept still is planned into batches, to build a few at a time. */
  private planAll() {
    const parts: PartPlan[] = [];
    this.seen = this.seen.filter((s) => !this.moving.has(s.mesh));
    this.seen.forEach((s, i) => {
      for (const p of s.parts) {
        p.mesh = i;
        parts.push(p);
      }
    });
    this.plan = planBatches(parts);
    // The biggest first: they're what saves the most.
    this.queue = [...this.plan.keys()].sort((a, b) => this.plan.get(b)!.length - this.plan.get(a)!.length);
    this.warmThenBuild(this.queue.length ? 'building' : 'ready');
  }

  /** The plain batches' own materials (white, coloured by their vertices) that are new, compiled before any batch is built (deps.warm). */
  private warmThenBuild(next: 'building' | 'ready') {
    const probes = new THREE.Group();
    for (const [p] of this.plan.values()) {
      if (!p.kind.plain || this.warmed.has(p.kind.key)) continue;
      this.warmed.add(p.kind.key);
      probes.add(probeOf(this.materialFor(p, this.seen[p.mesh])));
    }
    if (!this.deps.warm || !probes.children.length) return void (this.state = next);
    this.state = 'warming';
    const round = this.round;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<void>((resolve) => (timer = setTimeout(resolve, WARM_WAIT_MS)));
    void Promise.race([this.deps.warm(probes).catch(() => {}), waited]).then(() => {
      clearTimeout(timer);
      if (this.round === round && this.state === 'warming') this.state = next;
    });
  }

  private buildSome() {
    const t0 = this.now();
    do {
      const key = this.queue.shift();
      if (key === undefined) break;
      const plans = this.plan.get(key)!;
      this.build(key, plans);
    } while (this.now() - t0 < BUILD_MS);
    if (!this.queue.length) this.state = 'ready';
  }

  /** Merges batch `key` from `plans` (skipping meshes found to move meanwhile), and hides its meshes. */
  private build(key: string, plans: PartPlan[]) {
    const live = plans.filter((p) => !this.moving.has(this.seen[p.mesh].mesh));
    // A single-material mesh alone in a batch gains nothing.
    if (!live.length || (live.length === 1 && live[0].group < 0)) {
      this.plan.delete(key);
      for (const p of live) this.release(this.seen[p.mesh], key);
      return;
    }
    const first = live[0];
    const seen0 = this.seen[first.mesh];
    const material = this.materialFor(first, seen0);
    const parts: MergePart[] = live.map((p) => {
      const s = this.seen[p.mesh];
      const { start, count } = rangeOf(s.geometry, p.group);
      return { geometry: s.geometry, start, count, matrix: s.mesh.matrixWorld, color: first.kind.plain ? this.sourceOf(s, p).color : undefined };
    });
    const geometry = mergeParts(parts, { uv: first.needsUv, color: first.kind.plain ? 'plain' : first.colored ? 'vertex' : null });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `batch ${key}`;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.matrixAutoUpdate = false;
    // Never what a ray lands on: the meshes it's made of still are.
    mesh.raycast = () => {};
    const old = this.batches.get(key);
    if (old) this.free(old);
    this.container(seen0.root).add(mesh);
    const batch: Batch = { key, root: seen0.root, mesh, members: live.map((p) => this.seen[p.mesh]), plans: live };
    this.batches.set(key, batch);
    this.plan.set(key, live);
    live.forEach((p, i) => {
      const s = batch.members[i];
      (s.batches ??= new Set()).add(key);
      if (!(s.mesh.layers instanceof Unseen)) s.mesh.layers = new Unseen(s.mesh.layers);
      const src = this.sourceOf(s, p);
      let r = this.mats.get(src);
      if (!r) this.mats.set(src, (r = recordOf(src, p.kind.plain)));
      r.plain ||= p.kind.plain;
      r.users.add(s);
    });
  }

  /** The material part `p` of `s` is drawn with. */
  private sourceOf(s: Seen, p: PartPlan): AnyMaterial {
    return (Array.isArray(s.material) ? s.material[s.geometry.groups[p.group].materialIndex ?? 0] : s.material) as AnyMaterial;
  }

  private materialFor(p: PartPlan, s: Seen): THREE.Material {
    const src = this.sourceOf(s, p);
    if (!p.kind.plain) return src;
    let m = this.plainMats.get(p.kind.key);
    if (!m) this.plainMats.set(p.kind.key, (m = plainMaterial(src)));
    return m;
  }

  private free(b: Batch) {
    b.mesh.removeFromParent();
    b.mesh.geometry.dispose();
  }

  /** `s` is no longer drawn in batch `key`: once it's in none, it draws itself again. */
  private release(s: Seen, key: string) {
    s.batches?.delete(key);
    if (!s.batches?.size) this.unhide(s);
  }

  private unhide(s: Seen) {
    s.batches?.clear();
    const l = s.mesh.layers;
    if (l instanceof Unseen) s.mesh.layers = l.was;
  }

  /**
   * Just before the office is drawn (once a frame): every mesh watched, or batched, is where it was and
   * as it was. One that isn't draws itself from now on, and its batches are merged again without it.
   */
  private check() {
    if (this.checkedFrame === this.frameNo || this.state === 'off' || this.deps.paused()) return;
    this.checkedFrame = this.frameNo;
    if (this.state === 'watching') this.frames++;
    const changed = this.changed();
    if (!changed.length) return;
    let batchedChanged = 0;
    for (const s of changed) if (s.batches?.size) batchedChanged++;
    if (batchedChanged > TOO_MANY) {
      // Much has changed: start over, watching afresh.
      this.start();
      return;
    }
    const again = new Set<string>();
    for (const s of changed) {
      if (!this.moving.has(s.mesh)) {
        this.moving.add(s.mesh);
        this.movingCount++;
      }
      for (const key of s.batches ?? []) again.add(key);
      this.unhide(s);
    }
    for (const key of again) {
      const plans = this.plan.get(key);
      if (!plans) continue;
      this.rebuilds++;
      // Merged again at once, so nothing's drawn twice (by itself and in its old batch).
      const old = this.batches.get(key);
      if (old) {
        this.free(old);
        this.batches.delete(key);
        for (const s of old.members) s.batches?.delete(key);
      }
      this.build(key, plans);
      for (const s of old?.members ?? []) if (!s.batches?.size) this.unhide(s);
    }
  }

  /** The watched meshes that have moved, been hidden or taken out, or changed what they're drawn with, since they were seen. */
  private changed(): Seen[] {
    if (this.nodeOk.length < this.nodes.length) this.nodeOk = new Uint8Array(this.nodes.length * 2);
    const nodeOk = this.nodeOk;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      nodeOk[i] = n.node.visible === n.visible && n.node.parent === n.parent ? 1 : 0;
    }
    const out = new Set<Seen>();
    // A material drawn differently now: every mesh batched with it.
    for (const [m, r] of this.mats) {
      if (stillAs(m as AnyMaterial, r)) continue;
      for (const s of r.users) if (!this.moving.has(s.mesh)) out.add(s);
      // Those meshes draw themselves from now on: the batches merged again record what's left.
      this.mats.delete(m);
    }
    for (const s of this.seen) {
      if (out.has(s) || this.moving.has(s.mesh)) continue;
      const m = s.mesh;
      let ok = m.visible && m.parent === s.parent && m.geometry === s.geometry && sameMaterial(m.material, s.material) && m.castShadow === s.cast && m.receiveShadow === s.receive;
      for (let i = 0; ok && i < s.chain.length; i++) ok = nodeOk[s.chain[i]] === 1;
      if (ok) {
        const e = m.matrixWorld.elements;
        for (let i = 0; ok && i < 16; i++) ok = e[i] === s.matrix[i];
      }
      if (ok) {
        versionsInto(s.geometry, scratch);
        for (let i = 0; ok && i < VERSIONS; i++) ok = scratch[i] === s.versions[i];
      }
      if (!ok) out.add(s);
    }
    return [...out];
  }
}
