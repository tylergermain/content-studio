import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Quaternion, Vector3 } from 'three';
import { FURNITURE, type FurnitureKind, type KindDef } from '../src/shared/furniture.js';
import { openModel } from './glb';

// What the furniture packs' tests share (rooms-model, studio-model and greenery-model): a model that
// holds several pieces of furniture, each a root named for its kind, read down to its vertices, so a
// test can ask where a piece's parts of one material are, and whether it fits its kind's footprint
// (shared/furniture.ts).

type Primitive = { attributes: Record<string, number>; material?: number; indices?: number };
type Accessor = { bufferView?: number; byteOffset?: number; count: number; componentType: number; type: string };

export const near = (a: number, b: number, tolerance = 0.005) => Math.abs(a - b) <= tolerance;
export const fmt = (v: Vector3) => v.toArray().map((n) => n.toFixed(3)).join(', ');

export function openPack(name: string) {
  const model = openModel(name);
  const { gltf, nodes, byName } = model;
  const file = readFileSync(new URL(`../src/client/models/${name}.glb`, import.meta.url));
  // The binary chunk, where the vertices are: straight after the JSON chunk (whose length is padded to 4).
  const json = 20 + file.readUInt32LE(12);
  assert.equal(file.toString('ascii', json + 4, json + 8), 'BIN\0', 'the second chunk is the binary one');
  const bin = file.subarray(json + 8, json + 8 + file.readUInt32LE(json));
  const views = (gltf as unknown as { bufferViews: { byteOffset?: number; byteStride?: number }[] }).bufferViews;
  const accessor = (i: number) => gltf.accessors[i] as unknown as Accessor;

  const primitives = (node: string) => {
    assert.ok(byName(node) >= 0, `a node called ${node}`);
    return (gltf.meshes[nodes[byName(node)].mesh ?? -1]?.primitives ?? []) as Primitive[];
  };
  const materialOf = (p: Primitive) => gltf.materials?.[p.material ?? -1]?.name ?? '';

  /** A node's vertices where they stand in the model, only those of `materials` if given. */
  function vertices(node: string, materials?: readonly string[]): Vector3[] {
    const m = model.worldMatrix(byName(node));
    const out: Vector3[] = [];
    for (const p of primitives(node)) {
      if (materials && !materials.includes(materialOf(p))) continue;
      const a = accessor(p.attributes.POSITION);
      assert.ok(a.componentType === 5126 && a.type === 'VEC3', 'positions are three floats');
      const view = views[a.bufferView ?? -1];
      const stride = view.byteStride ?? 12;
      const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
      for (let k = 0; k < a.count; k++) {
        const o = start + k * stride;
        out.push(new Vector3(bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)).applyMatrix4(m));
      }
    }
    return out;
  }

  return {
    ...model,
    vertices,
    /** The materials a node is made of, each once. */
    madeOf: (node: string) => [...new Set(primitives(node).map(materialOf))].sort(),
    bounds(node: string, materials?: readonly string[]): Box3 {
      const vs = vertices(node, materials);
      assert.ok(vs.length, `${node} has vertices${materials ? ` of ${materials}` : ''}`);
      return new Box3().setFromPoints(vs);
    },
    trianglesOf: (node: string) => primitives(node).reduce((n, p) => n + accessor(p.indices!).count / 3, 0),
    /** Every root is at the origin and not turned: it faces +z as modelled. */
    assertPlaced(names: readonly string[]) {
      for (const name of names) {
        const { at, turn } = model.placed(byName(name));
        assert.ok(at.length() < 1e-4, `${name} is at ${fmt(at)}`);
        assert.ok(turn.angleTo(new Quaternion()) < 1e-4, `${name} isn't turned`);
      }
    },
  };
}

/** What the catalog says of a kind: how much floor it takes and how high its collider is. */
export const kind = (k: FurnitureKind): KindDef => FURNITURE[k];

/**
 * Whether every point is over a kind's footprint: inside its `w` by `d` about the origin, or within
 * its `r` of it. `over` is how far past it they may reach (a plant's leaves do, its planter doesn't).
 */
export function assertInFootprint(what: string, points: readonly Vector3[], k: KindDef, over = 0.001) {
  assert.ok(points.length, `${what} has vertices`);
  for (const p of points) {
    if (k.r !== undefined) assert.ok(Math.hypot(p.x, p.z) <= k.r + over, `${what} reaches ${Math.hypot(p.x, p.z).toFixed(3)} from its middle, past its ${k.r} m`);
    else assert.ok(Math.abs(p.x) <= k.w! / 2 + over && Math.abs(p.z) <= k.d! / 2 + over, `${what} reaches (${p.x.toFixed(3)}, ${p.z.toFixed(3)}), past its ${k.w} by ${k.d} m`);
  }
}
