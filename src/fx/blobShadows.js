// Cheap contact shadows for XR: one instanced, soft, dark quad under every
// piece, projected onto the static surface below (planes, room mesh, ramps).
// Replaces a realtime shadow map plus shadow-catcher overdraw in passthrough.
// The surface below each piece is found with a physics ray cast that is only
// refreshed when the piece moved, with a small per-frame ray budget.

import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { DIM } from '../core/pieceDefs.js';

const RAYS_PER_FRAME = 12;
const MAX_HEIGHT = 0.4; // blob fades out completely at this height above the surface
const LIFT = 0.0015;

const VERT = /* glsl */ `
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec2 c = (vUv - 0.5) * 2.0;
  float d = dot(c, c);
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a *= a * (3.0 - 2.0 * a);
  a *= vAlpha * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

// Full extents (x, y, z) and the local height of the visual centre.
function footprint(type) {
  switch (type) {
    case 'domino':
      return [DIM.domino.w, DIM.domino.h, DIM.domino.d, DIM.domino.h / 2];
    case 'marble':
      return [DIM.marble.r * 2, DIM.marble.r * 2, DIM.marble.r * 2, 0];
    case 'trigger':
      return [DIM.trigger.r * 2, DIM.trigger.r * 2, DIM.trigger.r * 2, 0];
    case 'pin':
      return [DIM.pin.base * 2.1, DIM.pin.h, DIM.pin.base * 2.1, DIM.pin.h / 2];
    case 'barrel':
      return [DIM.barrel.r * 2, DIM.barrel.h, DIM.barrel.r * 2, DIM.barrel.h / 2];
    case 'ramp':
      return [DIM.ramp.w + 0.012, DIM.ramp.rise, DIM.ramp.len, DIM.ramp.rise / 2];
    case 'bumper':
      return [DIM.bumper.r * 2.2, DIM.bumper.h, DIM.bumper.r * 2.2, DIM.bumper.h / 2];
    case 'seesaw':
      return [DIM.seesaw.w, DIM.seesaw.pivot, DIM.seesaw.len, DIM.seesaw.pivot / 2];
    default:
      return [0.05, 0.05, 0.05, 0];
  }
}

const FOOT = {};
const _q = new Quaternion();
const _ax = new Vector3();
const _ay = new Vector3();
const _az = new Vector3();
const _n = new Vector3();
const _bx = new Vector3();
const _bz = new Vector3();
const _c = new Vector3();
const _m = new Matrix4();
const _origin = new Vector3();
const DOWN = new Vector3(0, -1, 0);

export class BlobShadows {
  constructor(scene, sim, capacity = 1400) {
    this.sim = sim;
    this.capacity = capacity;
    this.cursor = 0;
    this.enabled = false;
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.alpha = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.alpha.setUsage(DynamicDrawUsage);
    geo.setAttribute('aAlpha', this.alpha);
    this.material = new ShaderMaterial({
      uniforms: { uOpacity: { value: 0.62 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new InstancedMesh(geo, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.mesh.visible = false;
  }

  _state(p) {
    let s = p.userData.blob;
    if (!s) {
      s = p.userData.blob = { has: false, y: 0, nx: 0, ny: 1, nz: 0, rx: 1e9, ry: 1e9, rz: 1e9 };
    }
    return s;
  }

  update(alpha) {
    if (!this.enabled) return;
    const pieces = this.sim.pieces;
    const len = pieces.length;
    let rays = RAYS_PER_FRAME;
    // Held pieces always get a fresh ray, the rest round-robin when moved.
    for (let i = 0; i < len; i++) {
      const p = pieces[i];
      if (p.held && !p.hidden) {
        this._cast(p, this._centre(p, alpha));
        rays--;
      }
    }
    for (let k = 0; k < len && rays > 0; k++) {
      const p = pieces[(this.cursor + k) % len];
      if (p.held || p.hidden) continue;
      const s = this._state(p);
      const c = this._centre(p, alpha);
      const dx = c.x - s.rx;
      const dy = c.y - s.ry;
      const dz = c.z - s.rz;
      if (s.has && dx * dx + dy * dy + dz * dz < 0.004 * 0.004) continue;
      this._cast(p, c);
      rays--;
    }
    this.cursor = len ? (this.cursor + 1) % len : 0;

    const mesh = this.mesh;
    const a = this.alpha.array;
    let n = 0;
    for (let i = 0; i < len && n < this.capacity; i++) {
      const p = pieces[i];
      if (p.hidden) continue;
      const s = this._state(p);
      if (!s.has) continue;
      const f = FOOT[p.type] || (FOOT[p.type] = footprint(p.type));
      const c = this._centre(p, alpha);
      // Piece axes from the (current) orientation.
      const buf = p.interp[0];
      _q.set(buf[10], buf[11], buf[12], buf[13]);
      _ax.set(1, 0, 0).applyQuaternion(_q);
      _ay.set(0, 1, 0).applyQuaternion(_q);
      _az.set(0, 0, 1).applyQuaternion(_q);
      // Lowest point of the oriented box above the surface.
      const halfDown = (f[0] * Math.abs(_ax.y) + f[1] * Math.abs(_ay.y) + f[2] * Math.abs(_az.y)) * 0.5;
      const h = c.y - halfDown - s.y;
      const fade = 1 - Math.max(0, h) / MAX_HEIGHT;
      if (fade <= 0.02) continue;
      _n.set(s.nx, s.ny, s.nz);
      // Blob axes: piece X projected onto the surface, plus the perpendicular.
      _bx.copy(_ax).addScaledVector(_n, -_ax.dot(_n));
      if (_bx.lengthSq() < 1e-6) _bx.copy(_az).addScaledVector(_n, -_az.dot(_n));
      _bx.normalize();
      _bz.crossVectors(_bx, _n);
      const ex = f[0] * Math.abs(_ax.dot(_bx)) + f[1] * Math.abs(_ay.dot(_bx)) + f[2] * Math.abs(_az.dot(_bx));
      const ez = f[0] * Math.abs(_ax.dot(_bz)) + f[1] * Math.abs(_ay.dot(_bz)) + f[2] * Math.abs(_az.dot(_bz));
      // Soft penumbra: grows with the footprint and the height above ground.
      const spread = 1.6 + Math.max(0, h) * 2.5;
      const sx = ex * spread + 0.03;
      const sz = ez * spread + 0.03;
      _m.makeBasis(_bx, _n, _bz);
      const el = _m.elements;
      el[0] *= sx;
      el[1] *= sx;
      el[2] *= sx;
      el[8] *= sz;
      el[9] *= sz;
      el[10] *= sz;
      // Project the centre straight down onto the cached surface height.
      el[12] = c.x + _n.x * LIFT;
      el[13] = s.y + _n.y * LIFT;
      el[14] = c.z + _n.z * LIFT;
      mesh.setMatrixAt(n, _m);
      a[n] = fade * fade;
      n++;
    }
    mesh.count = n;
    mesh.visible = n > 0;
    if (n > 0) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      this.alpha.clearUpdateRanges();
      this.alpha.addUpdateRange(0, n);
      this.alpha.needsUpdate = true;
    }
  }

  _centre(p, alpha) {
    const b = p.interp[0];
    const f = FOOT[p.type] || (FOOT[p.type] = footprint(p.type));
    _c.set(b[0] + (b[7] - b[0]) * alpha, b[1] + (b[8] - b[1]) * alpha, b[2] + (b[9] - b[2]) * alpha);
    if (f[3] !== 0) {
      _q.set(b[10], b[11], b[12], b[13]);
      _ay.set(0, f[3], 0).applyQuaternion(_q);
      _c.add(_ay);
    }
    return _c;
  }

  _cast(p, c) {
    const s = this._state(p);
    s.rx = c.x;
    s.ry = c.y;
    s.rz = c.z;
    _origin.copy(c);
    const hit = this.sim.castRay(_origin, DOWN, 1.5, 'surface', p);
    if (!hit) {
      s.has = false;
      return;
    }
    s.has = true;
    s.y = c.y - hit.distance;
    let nx = hit.normal.x;
    let ny = hit.normal.y;
    let nz = hit.normal.z;
    if (nx * nx + ny * ny + nz * nz < 0.25) {
      nx = 0;
      ny = 1;
      nz = 0;
    } else if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    s.nx = nx;
    s.ny = ny;
    s.nz = nz;
  }
}
