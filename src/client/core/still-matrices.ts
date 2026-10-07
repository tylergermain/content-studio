import * as THREE from 'three';

// Matrices worked out again only for what's moved. Every frame three works out every object's matrix from its
// position, rotation and scale (updateMatrix), and so every object's place in the world after it, whether it
// moved or not: thousands of them on a floor, nearly all of which never move. Here an object's matrix is
// worked out again only when its position, rotation, scale or pivot isn't what it was last time; when it is,
// nothing is redone, and its place in the world is only worked out again if something above it moved. An
// object added somewhere new (Object3D.add, which attach goes through too) has its place worked out again
// under its new parent, moved or not. Anything that moves is exactly as before.

type Kept = THREE.Object3D & { __trs?: Float64Array };

const proto = THREE.Object3D.prototype;
const compose = proto.updateMatrix;

proto.updateMatrix = function (this: Kept) {
  const p = this.position, q = this.quaternion, s = this.scale, v = this.pivot;
  const c = this.__trs;
  if (
    c &&
    c[0] === p.x && c[1] === p.y && c[2] === p.z &&
    c[3] === q.x && c[4] === q.y && c[5] === q.z && c[6] === q.w &&
    c[7] === s.x && c[8] === s.y && c[9] === s.z &&
    (v ? c[13] === 1 && c[10] === v.x && c[11] === v.y && c[12] === v.z : c[13] === 0)
  ) return;
  compose.call(this);
  const k = (this.__trs ??= new Float64Array(14));
  k[0] = p.x; k[1] = p.y; k[2] = p.z;
  k[3] = q.x; k[4] = q.y; k[5] = q.z; k[6] = q.w;
  k[7] = s.x; k[8] = s.y; k[9] = s.z;
  if (v) {
    k[10] = v.x; k[11] = v.y; k[12] = v.z; k[13] = 1;
  } else k[13] = 0;
};

const add = proto.add;
proto.add = function (this: THREE.Object3D, ...objects: THREE.Object3D[]) {
  add.apply(this, objects);
  for (const o of objects) if (o && o !== this) o.matrixWorldNeedsUpdate = true;
  return this;
};
