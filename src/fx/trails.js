// Glowing ribbon trails for rolling balls. All trails share one geometry and
// one draw call; ribbons are rebuilt camera-facing on the CPU each frame.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';

const SEG = 22;
const MAX = 24;

const VERT = /* glsl */ `
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  gl_FragColor = vec4(vColor.rgb * vColor.a, 0.0);
}`;

const _a = new Vector3();
const _b = new Vector3();
const _t = new Vector3();
const _toCam = new Vector3();
const _side = new Vector3();

export class Trails {
  constructor(scene) {
    const vertCount = MAX * SEG * 2;
    this.positions = new Float32Array(vertCount * 3);
    this.colors = new Float32Array(vertCount * 4);
    const indices = [];
    for (let t = 0; t < MAX; t++) {
      for (let k = 0; k < SEG - 1; k++) {
        const o = (t * SEG + k) * 2;
        indices.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
    const geo = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
    this.colAttr = new BufferAttribute(this.colors, 4).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setIndex(indices);
    this.mesh = new Mesh(
      geo,
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: 2,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.slots = [];
    for (let i = 0; i < MAX; i++) {
      this.slots.push({ piece: null, hist: new Float32Array(SEG * 3), count: 0, energy: 0, r: 1, g: 1, b: 1, width: 0.01, cleared: false });
    }
  }

  attach(piece, r, g, b, width) {
    for (const s of this.slots) {
      if (!s.piece) {
        s.piece = piece;
        s.count = 0;
        s.energy = 0;
        s.r = r;
        s.g = g;
        s.b = b;
        s.width = width;
        return;
      }
    }
  }

  detach(piece) {
    for (const s of this.slots) if (s.piece === piece) s.piece = null;
  }

  reset() {
    for (const s of this.slots) {
      s.count = 0;
      s.energy = 0;
    }
  }

  update(camPos, dt) {
    const pos = this.positions;
    const col = this.colors;
    let wrote = false;
    let visible = false;
    for (let si = 0; si < MAX; si++) {
      const s = this.slots[si];
      const base = si * SEG * 2;
      const p = s.piece;
      if (p && p.view && !p.hidden) {
        const buf = p.interp[0];
        _a.set(buf[7], buf[8], buf[9]);
        const h = s.hist;
        if (s.count === 0) {
          for (let k = 0; k < SEG; k++) {
            h[k * 3] = _a.x;
            h[k * 3 + 1] = _a.y;
            h[k * 3 + 2] = _a.z;
          }
          s.count = 1;
        }
        _b.set(h[0], h[1], h[2]);
        const moved = _a.distanceTo(_b);
        if (moved > 0.004) {
          h.copyWithin(3, 0, (SEG - 1) * 3);
          h[0] = _a.x;
          h[1] = _a.y;
          h[2] = _a.z;
          s.energy = Math.min(1, s.energy + moved * 12);
        } else {
          s.energy = Math.max(0, s.energy - dt * 1.5);
          if (s.energy === 0) {
            for (let k = 0; k < SEG; k++) {
              h[k * 3] = _a.x;
              h[k * 3 + 1] = _a.y;
              h[k * 3 + 2] = _a.z;
            }
          }
        }
      } else {
        s.energy = 0;
      }
      // Idle slots were already collapsed; nothing to rebuild or upload.
      if (s.energy <= 0.001 && s.cleared) continue;
      s.cleared = s.energy <= 0.001;
      if (!s.cleared) visible = true;
      wrote = true;
      for (let k = 0; k < SEG; k++) {
        const vi = base + k * 2;
        const h = s.hist;
        const fade = s.energy * (1 - k / (SEG - 1));
        if (fade <= 0.001) {
          for (let j = 0; j < 2; j++) {
            pos[(vi + j) * 3] = 0;
            pos[(vi + j) * 3 + 1] = -100;
            pos[(vi + j) * 3 + 2] = 0;
            col[(vi + j) * 4 + 3] = 0;
          }
          continue;
        }
        const k0 = Math.max(0, k - 1);
        const k1 = Math.min(SEG - 1, k + 1);
        _a.set(h[k * 3], h[k * 3 + 1], h[k * 3 + 2]);
        _t.set(h[k0 * 3] - h[k1 * 3], h[k0 * 3 + 1] - h[k1 * 3 + 1], h[k0 * 3 + 2] - h[k1 * 3 + 2]);
        _toCam.subVectors(camPos, _a);
        _side.crossVectors(_t, _toCam);
        const len = _side.length();
        if (len > 1e-6) _side.multiplyScalar((s.width * (0.25 + 0.75 * (1 - k / SEG))) / len);
        else _side.set(0, 0, 0);
        pos[vi * 3] = _a.x + _side.x;
        pos[vi * 3 + 1] = _a.y + _side.y;
        pos[vi * 3 + 2] = _a.z + _side.z;
        pos[(vi + 1) * 3] = _a.x - _side.x;
        pos[(vi + 1) * 3 + 1] = _a.y - _side.y;
        pos[(vi + 1) * 3 + 2] = _a.z - _side.z;
        for (let j = 0; j < 2; j++) {
          const c = (vi + j) * 4;
          col[c] = s.r;
          col[c + 1] = s.g;
          col[c + 2] = s.b;
          col[c + 3] = fade * fade;
        }
      }
    }
    this.mesh.visible = visible;
    if (wrote) {
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
    }
  }
}
