/**
 * VR mode's contracts: what its parts (the session, the rig, the controllers, the panels, presence,
 * quality and perf) hand one another. Types only, so the office's first load carries none of VR's code
 * (see features/vr/index.ts and docs/vr.md).
 */
import type * as THREE from 'three';
import type { Frame, Off, TickPhase } from '../../core/registry';

export type Hand = 'left' | 'right';

export interface VrQuality {
  name: 'quest2' | 'quest3' | 'other';
  outline: boolean;
  framebufferScale: number;      // 0.5..1, applied when a session starts
  foveation: number;             // 0..1
  frameRate: number | null;      // 72 | 80 | 90 | 120, or the headset's own
  shadows: 'on' | 'throttled' | 'off';
  shadowMapSize: number;
  shadowEveryMs: number;
  halos: boolean;
  maxLamps: number;              // 24 = all
  hotTextureEveryMs: number;     // 0 = no cap
  sceneryReach: number;          // x fog far for the scenic loop
  panelScale: number;            // texture px per CSS px
}

export interface VrPrefs { snapDeg: 30 | 45; vignette: boolean; heightOffset: number; dominant: Hand; scale: number | null; perf: boolean }

export interface VrSession {
  readonly xr: XRSession;
  readonly quality: VrQuality;
  readonly prefs: VrPrefs;
  frame(): XRFrame | null;
  /** Poses read here are in the office's world (the rig's offset space). */
  world(): XRReferenceSpace;
  /** The head as drawn this frame, world space; yaw/pitch in camYaw/lookPitch's convention. Set in 'steer'. */
  readonly head: { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion; yaw: number; pitch: number; height: number };
  tick(phase: TickPhase, fn: (f: Frame) => void): void;
  onEnd(fn: () => void): void;
  around(h: { before?(): void; after?(): void }): void;
  end(): void;
}

export interface VrRig { turn(rad: number): void; recenter(): void }

export interface Btn { readonly pressed: boolean; readonly down: boolean; readonly up: boolean; readonly value: number }
export interface VrHand {
  readonly hand: Hand;
  readonly connected: boolean;
  readonly ray: THREE.Ray;             // world, this frame
  readonly grip: THREE.Object3D;       // world, this frame (three's controller grip group)
  readonly trigger: Btn; readonly squeeze: Btn; readonly stickPress: Btn;
  readonly primary: Btn;               // A / X
  readonly secondary: Btn;             // B / Y
  readonly stick: { readonly x: number; readonly y: number };   // deadzoned, -1..1, y + = down/back
  pulse(strength: number, ms: number): void;
}
export interface VrControllers { readonly left: VrHand; readonly right: VrHand; readonly dominant: Hand; byHand(h: Hand): VrHand }

export interface PanelHit { readonly panel: string; readonly point: THREE.Vector3; readonly uv: THREE.Vector2; readonly distance: number }
export interface NativePanel {
  readonly id: string;
  readonly mesh: THREE.Mesh;           // a plane; uv (0,0) bottom-left
  visible(): boolean;
  point(kind: 'move' | 'down' | 'up' | 'leave', uv: THREE.Vector2, hand: Hand): void;
  scroll?(dy: number): void;
}
export interface PanelHost {
  readonly busy: boolean;              // a window, the sheet or the keyboard is up
  hit(ray: THREE.Ray): PanelHit | null;
  point(hand: Hand, hit: PanelHit | null, trigger: Btn, scroll: number): void;
  worldClick(hand: Hand, at: THREE.Vector3 | null, trigger: Btn): void;
  grab(hand: Hand, hit: PanelHit | null, squeeze: Btn, push: number): boolean;   // true when it took the grip
  back(): boolean;                     // false: caller sends Escape
  toggleSheet(): void;
  toggleKeyboard(): void;
  add(p: NativePanel): Off;
}

export interface VrPerf { toggle(): void; readonly samples: readonly VrPerfSample[] }
export interface VrPerfSample { at: number; fps: number; late: number; cpuMs: number; gpuMs: number | null; calls: number; triangles: number; programs: number; textures: number; paintMs: number }
export interface VrKnobs { readonly quality: VrQuality; set<K extends keyof VrQuality>(k: K, v: VrQuality[K]): void }

export interface VrDebug {
  presenting: boolean; frames: number; profile: string;
  pads?: VrControllers; panels?: { ids(): string[]; lastPaintMs: number }; perf?: VrPerf; knobs?: VrKnobs;
}
