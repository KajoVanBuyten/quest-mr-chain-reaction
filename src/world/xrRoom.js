// Turns the WebXR room understanding (planes + meshes) into static physics
// colliders, depth-only occluders and a holographic scan reveal. Every
// feature is optional: without planes/meshes a floor at y = 0 is used.
//
// Performance notes:
// - Planes become cheap box colliders as soon as they change.
// - Room meshes are only rebuilt when their content really changed, and the
//   rebuild is debounced and spread over several frames (time-sliced job).
// - Mesh colliders are decimated (vertex clustering) and triangles that lie
//   on a detected plane are dropped, so pieces resting on a table touch one
//   flat box instead of a noisy triangle soup.
// - All occluder meshes are merged into one depth-only draw call.
// - The scan sweep only exists during the intro and is removed afterwards.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';

const SCAN_DURATION = 6.5;
const REBUILD_DELAY = 0.5; // seconds without changes before rebuilding mesh colliders
const SLICE_MS = 2; // time budget per frame for the background rebuild job
const SMALL_MESH_TRIS = 4000; // meshes below this are used as-is
const MAX_COLLIDER_TRIS = 12000; // per mesh after decimation
const CHUNK_TRIS = 3000; // one trimesh collider per chunk, one chunk per frame
const PLANE_EPS = 0.05; // triangles within 5 cm of a plane are covered by it

const SCAN_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Grid lines are derived from the world position, which looks like a
// wireframe without the cost of building a line index for the room mesh.
const SCAN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uOrigin;
uniform vec3 uColor;
uniform float uFade;
varying vec3 vWorld;
void main() {
  float d = distance(vWorld, uOrigin);
  float front = uTime * 1.5;
  float band = exp(-pow((d - front) * 7.0, 2.0));
  float behind = d < front ? exp(-(front - d) * 1.6) * 0.45 : 0.0;
  vec3 g = abs(fract(vWorld * 8.0) - 0.5);
  float grid = smoothstep(0.44, 0.5, max(g.x, max(g.y, g.z)));
  float a = (band * (0.35 + grid * 1.1) + behind * grid) * uFade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 0.0);
}`;

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _c = new Vector3();
const _up = new Vector3();
const IDENTITY_Q = new Quaternion();
const ZERO = new Vector3();

function planeFingerprint(plane, pose) {
  const poly = plane.polygon;
  let h = poly ? poly.length : 0;
  if (poly) for (let i = 0; i < poly.length; i++) h += poly[i].x * 3.1 + poly[i].z * 7.7;
  const t = pose.transform.position;
  return h + t.x * 11.3 + t.y * 13.7 + t.z * 17.9;
}

function meshFingerprint(mesh, pose) {
  const v = mesh.vertices;
  const idx = mesh.indices;
  if (!v || !idx) return 0;
  let h = v.length * 1.7 + idx.length * 3.3;
  const step = Math.max(3, Math.floor(v.length / 96 / 3) * 3);
  for (let i = 0; i < v.length; i += step) h += v[i] * (1 + (i % 7)) + v[i + 1] * 2.3 + v[i + 2] * 5.1;
  const t = pose.transform.position;
  return h + t.x * 11.3 + t.y * 13.7 + t.z * 17.9;
}

export class XRRoom {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.planes = new Map();
    this.meshes = new Map();
    this.floorBody = null;
    this.active = false;
    this.scanTime = 0;
    this.scanAlive = false;
    this.useOcclusionMeshes = false;
    this.planeSupport = false;
    this.meshSupport = false;
    this._surfaces = [];
    this.meshBodies = [];
    this.occluder = null;
    this.dirtyAt = -1;
    this.job = null;
    this.jobBodies = [];
    this.clock = 0;
    this.rebuilds = 0;

    this.occluderMat = new MeshBasicMaterial({ colorWrite: false });
    // Push occluders slightly back so virtual pieces resting on a real
    // surface are not clipped by mesh noise.
    this.occluderMat.polygonOffset = true;
    this.occluderMat.polygonOffsetFactor = 1;
    this.occluderMat.polygonOffsetUnits = 4;
    this.scanMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOrigin: { value: new Vector3() },
        uColor: { value: new Color(0.3, 0.95, 1.0) },
        uFade: { value: 1 },
      },
      vertexShader: SCAN_VERT,
      fragmentShader: SCAN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
  }

  start(origin, { planes = true, meshes = true, occlusion = true } = {}) {
    this.planesEnabled = planes;
    this.meshesEnabled = meshes;
    this.useOcclusionMeshes = occlusion;
    this.planeSupport = false;
    this.meshSupport = false;
    this.active = true;
    this.scanTime = 0;
    this.scanAlive = true;
    this.clock = 0;
    this.dirtyAt = -1;
    this.job = null;
    this.jobBodies = [];
    this.scanMat.uniforms.uOrigin.value.copy(origin);
    this.scanMat.uniforms.uFade.value = 1;
    this.floorBody = this.sim.addStaticBox(new Vector3(0, -0.06, 0), new Quaternion(), 25, 0.06, 25);
  }

  stop() {
    this.active = false;
    this._abortJob();
    for (const e of this.planes.values()) this._removePlane(e);
    for (const e of this.meshes.values()) this._removeMeshVisual(e);
    this.planes.clear();
    this.meshes.clear();
    this._surfaces = [];
    this._clearMeshColliders();
    this._setOccluder(null);
    if (this.floorBody) this.sim.removeStatic(this.floorBody);
    this.floorBody = null;
  }

  update(frame, refSpace, dt) {
    if (!this.active || !frame) return;
    this.clock += dt;
    this._updateScan(dt);

    let planes = null;
    if (this.planesEnabled) {
      try {
        planes = frame.detectedPlanes;
      } catch {
        this.planesEnabled = false;
      }
    }
    if (planes) {
      this.planeSupport = true;
      let changed = false;
      planes.forEach((plane) => {
        let e = this.planes.get(plane);
        if (e) e.seen = this.clock;
        if (e && e.lastChanged === plane.lastChangedTime) return;
        const pose = frame.getPose(plane.planeSpace, refSpace);
        if (!pose) return;
        const fp = planeFingerprint(plane, pose);
        if (e && e.fp === fp) {
          e.lastChanged = plane.lastChangedTime;
          return;
        }
        if (e) this._removePlane(e);
        e = this._buildPlane(plane, pose);
        if (e) {
          e.fp = fp;
          e.seen = this.clock;
          this.planes.set(plane, e);
        } else {
          this.planes.delete(plane);
        }
        changed = true;
      });
      for (const [plane, e] of this.planes) {
        if (e.seen !== this.clock) {
          this._removePlane(e);
          this.planes.delete(plane);
          changed = true;
        }
      }
      if (changed) {
        this._rebuildSurfaces();
        this._markDirty();
      }
    }

    let meshes = null;
    if (this.meshesEnabled) {
      try {
        meshes = frame.detectedMeshes;
      } catch {
        this.meshesEnabled = false;
      }
    }
    if (meshes) {
      this.meshSupport = true;
      let changed = false;
      meshes.forEach((mesh) => {
        let e = this.meshes.get(mesh);
        if (e) e.seen = this.clock;
        if (e && e.lastChanged === mesh.lastChangedTime) return;
        const pose = frame.getPose(mesh.meshSpace, refSpace);
        if (!pose) return;
        const fp = meshFingerprint(mesh, pose);
        if (e && e.fp === fp) {
          e.lastChanged = mesh.lastChangedTime;
          return;
        }
        if (e) this._removeMeshVisual(e);
        e = this._captureMesh(mesh, pose);
        if (e) {
          e.fp = fp;
          e.seen = this.clock;
          this.meshes.set(mesh, e);
        } else {
          this.meshes.delete(mesh);
        }
        changed = true;
      });
      for (const [mesh, e] of this.meshes) {
        if (e.seen !== this.clock) {
          this._removeMeshVisual(e);
          this.meshes.delete(mesh);
          changed = true;
        }
      }
      if (changed) this._markDirty();
    }

    if (this.dirtyAt >= 0 && this.clock - this.dirtyAt > REBUILD_DELAY && !this.job) {
      this.dirtyAt = -1;
      this.job = this._rebuildJob();
    }
    if (this.job) {
      const until = performance.now() + SLICE_MS;
      // The generator checks the deadline itself; one next() per frame.
      const r = this.job.next(until);
      if (r.done) {
        this.job = null;
        this.jobBodies = [];
      }
    }
  }

  _markDirty() {
    this.dirtyAt = this.clock;
    // A newer change restarts the job with fresh data.
    this._abortJob();
  }

  _abortJob() {
    if (!this.job) return;
    this.job = null;
    for (const b of this.jobBodies) this.sim.removeStatic(b);
    this.jobBodies = [];
  }

  // ------------------------------------------------------------------ scan
  _updateScan(dt) {
    if (!this.scanAlive) return;
    this.scanTime += dt;
    const u = this.scanMat.uniforms;
    u.uTime.value = this.scanTime;
    u.uFade.value = this.scanTime < SCAN_DURATION - 2 ? 1 : Math.max(0, (SCAN_DURATION - this.scanTime) / 2);
    if (this.scanTime >= SCAN_DURATION) {
      this.scanAlive = false;
      for (const e of this.planes.values()) this._dropScan(e);
      for (const e of this.meshes.values()) this._dropScan(e);
    }
  }

  _dropScan(e) {
    if (!e.scan) return;
    this.scene.remove(e.scan);
    if (e.scanOwnsGeometry) e.scan.geometry.dispose();
    e.scan = null;
  }

  // ---------------------------------------------------------------- planes
  _buildPlane(plane, pose) {
    const poly = plane.polygon;
    if (!poly || poly.length < 3) return null;
    _m.fromArray(pose.transform.matrix);
    _m.decompose(_p, _q, _s);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const pt = poly[i];
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.z > maxZ) maxZ = pt.z;
    }
    const hx = Math.max(0.01, (maxX - minX) / 2);
    const hz = Math.max(0.01, (maxZ - minZ) / 2);
    const thick = 0.035;
    _c.set((minX + maxX) / 2, -thick, (minZ + maxZ) / 2).applyMatrix4(_m);
    const body = this.sim.addStaticBox(_c.clone(), _q.clone(), hx, thick, hz);

    let scan = null;
    if (this.scanAlive) {
      const outline = new BufferGeometry();
      const arr = new Float32Array(poly.length * 3);
      for (let i = 0; i < poly.length; i++) {
        arr[i * 3] = poly[i].x;
        arr[i * 3 + 1] = 0.003;
        arr[i * 3 + 2] = poly[i].z;
      }
      outline.setAttribute('position', new BufferAttribute(arr, 3));
      scan = new LineLoop(outline, this.scanMat);
      scan.matrixAutoUpdate = false;
      scan.matrix.copy(_m);
      scan.renderOrder = 5;
      scan.frustumCulled = false;
      this.scene.add(scan);
    }

    const normal = new Vector3(0, 1, 0).applyQuaternion(_q);
    _up.copy(normal);
    let surface = null;
    if (_up.y > 0.85) {
      const label = (plane.semanticLabel || '').toLowerCase();
      const center = new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2).applyMatrix4(_m);
      let kind = 'table';
      if (label === 'floor' || center.y < 0.25) kind = 'floor';
      else if (label === 'ceiling') kind = 'ceiling';
      surface = {
        kind,
        label,
        center,
        normal: _up.clone(),
        quaternion: _q.clone(),
        halfU: hx,
        halfV: hz,
        area: hx * hz * 4,
      };
    }
    // Data used to drop room-mesh triangles that this plane already covers.
    const cover = {
      inv: _m.clone().invert(),
      normal,
      minX: minX - 0.03,
      maxX: maxX + 0.03,
      minZ: minZ - 0.03,
      maxZ: maxZ + 0.03,
    };
    return { body, scan, scanOwnsGeometry: true, surface, cover, lastChanged: plane.lastChangedTime };
  }

  _removePlane(e) {
    this.sim.removeStatic(e.body);
    this._dropScan(e);
  }

  _rebuildSurfaces() {
    const out = [];
    for (const e of this.planes.values()) if (e.surface) out.push(e.surface);
    this._surfaces = out;
  }

  // ---------------------------------------------------------------- meshes
  _captureMesh(mesh, pose) {
    const vertices = mesh.vertices;
    const indices = mesh.indices;
    if (!vertices || !indices || indices.length < 3) return null;
    const v = new Float32Array(vertices);
    const idx = new Uint32Array(indices);
    const matrix = new Matrix4().fromArray(pose.transform.matrix);
    const e = { v, idx, matrix, scan: null, scanOwnsGeometry: true, lastChanged: mesh.lastChangedTime };
    if (this.scanAlive) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(v, 3));
      geo.setIndex(new BufferAttribute(idx, 1));
      const scan = new Mesh(geo, this.scanMat);
      scan.matrixAutoUpdate = false;
      scan.matrix.copy(matrix);
      scan.renderOrder = 5;
      scan.frustumCulled = false;
      this.scene.add(scan);
      e.scan = scan;
    }
    return e;
  }

  _removeMeshVisual(e) {
    this._dropScan(e);
  }

  _clearMeshColliders() {
    for (const b of this.meshBodies) this.sim.removeStatic(b);
    this.meshBodies = [];
  }

  _setOccluder(geo) {
    if (this.occluder) {
      this.scene.remove(this.occluder);
      this.occluder.geometry.dispose();
      this.occluder = null;
    }
    if (!geo) return;
    const m = new Mesh(geo, this.occluderMat);
    m.renderOrder = -2;
    m.matrixAutoUpdate = false;
    m.frustumCulled = false;
    this.scene.add(m);
    this.occluder = m;
  }

  /**
   * Time-sliced rebuild of mesh colliders and the merged occluder.
   * Each next(deadline) call works until performance.now() > deadline.
   */
  *_rebuildJob() {
    let deadline = yield;
    const entries = [...this.meshes.values()];
    const covers = [];
    for (const p of this.planes.values()) covers.push(p.cover);
    const bodies = (this.jobBodies = []);
    const over = () => performance.now() > deadline;

    for (const e of entries) {
      // World-space positions (shared by collider and occluder).
      if (!e.world) {
        const src = e.v;
        const w = new Float32Array(src.length);
        const el = e.matrix.elements;
        for (let i = 0; i < src.length; i += 3) {
          const x = src[i];
          const y = src[i + 1];
          const z = src[i + 2];
          w[i] = el[0] * x + el[4] * y + el[8] * z + el[12];
          w[i + 1] = el[1] * x + el[5] * y + el[9] * z + el[13];
          w[i + 2] = el[2] * x + el[6] * y + el[10] * z + el[14];
          if (i % 6144 === 0 && over()) deadline = yield;
        }
        e.world = w;
        deadline = yield;
      }
      const triCount = e.idx.length / 3;
      let pos = e.world;
      let tri = e.idx;
      if (triCount > SMALL_MESH_TRIS) {
        let cell = 0.025;
        let res = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          res = yield* decimate(e.world, e.idx, cell, over, (d) => (deadline = d));
          if (res.idx.length / 3 <= MAX_COLLIDER_TRIS) break;
          cell *= 1.6;
        }
        pos = res.pos;
        tri = res.idx;
      }
      if (covers.length) {
        tri = yield* dropCovered(pos, tri, covers, over, (d) => (deadline = d));
      }
      // Rapier builds the BVH of a trimesh in one go (~2 ms per 8k triangles
      // on desktop, several times that on Quest), so big meshes are split.
      for (let start = 0; start < tri.length; start += CHUNK_TRIS * 3) {
        deadline = yield;
        const part = tri.subarray(start, Math.min(tri.length, start + CHUNK_TRIS * 3));
        if (part.length >= 3) bodies.push(this.sim.addStaticTrimesh(ZERO, IDENTITY_Q, pos, part));
      }
      this.rebuilds++;
      deadline = yield;
    }

    // Swap colliders in one go so pieces never fall through a gap.
    this._clearMeshColliders();
    this.meshBodies = bodies;
    this.jobBodies = [];

    if (this.useOcclusionMeshes) {
      deadline = yield;
      let nv = 0;
      let ni = 0;
      for (const e of entries) {
        nv += e.world.length;
        ni += e.idx.length;
      }
      if (ni > 0) {
        const pos = new Float32Array(nv);
        const idx = new Uint32Array(ni);
        let vo = 0;
        let io = 0;
        for (const e of entries) {
          pos.set(e.world, vo);
          const base = vo / 3;
          const src = e.idx;
          for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + base;
          vo += e.world.length;
          io += src.length;
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(pos, 3));
        geo.setIndex(new BufferAttribute(idx, 1));
        this._setOccluder(geo);
      } else {
        this._setOccluder(null);
      }
    }
  }

  setOcclusionMeshes(enabled) {
    if (this.useOcclusionMeshes === enabled) return;
    this.useOcclusionMeshes = enabled;
    if (!enabled) this._setOccluder(null);
    else this._markDirty();
  }

  get surfaces() {
    return this._surfaces;
  }

  get summary() {
    return { planes: this.planes.size, meshes: this.meshes.size, planeSupport: this.planeSupport, meshSupport: this.meshSupport };
  }
}

// Vertex clustering: snaps vertices to a grid of `cell` metres, averages
// each cluster and drops degenerate triangles. Generator, yields when over().
function* decimate(pos, idx, cell, over, setDeadline) {
  const vCount = pos.length / 3;
  const remap = new Int32Array(vCount);
  const map = new Map();
  const acc = [];
  const inv = 1 / cell;
  for (let i = 0; i < vCount; i++) {
    const kx = Math.floor(pos[i * 3] * inv) + 4096;
    const ky = Math.floor(pos[i * 3 + 1] * inv) + 4096;
    const kz = Math.floor(pos[i * 3 + 2] * inv) + 4096;
    const key = kx + ky * 8192 + kz * 67108864;
    let c = map.get(key);
    if (c === undefined) {
      c = acc.length / 4;
      map.set(key, c);
      acc.push(0, 0, 0, 0);
    }
    acc[c * 4] += pos[i * 3];
    acc[c * 4 + 1] += pos[i * 3 + 1];
    acc[c * 4 + 2] += pos[i * 3 + 2];
    acc[c * 4 + 3] += 1;
    remap[i] = c;
    if ((i & 1023) === 0 && over()) setDeadline(yield);
  }
  const n = acc.length / 4;
  const out = new Float32Array(n * 3);
  for (let c = 0; c < n; c++) {
    const k = acc[c * 4 + 3];
    out[c * 3] = acc[c * 4] / k;
    out[c * 3 + 1] = acc[c * 4 + 1] / k;
    out[c * 3 + 2] = acc[c * 4 + 2] / k;
  }
  const tri = new Uint32Array(idx.length);
  const seen = new Set();
  let t = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = remap[idx[i]];
    const b = remap[idx[i + 1]];
    const c = remap[idx[i + 2]];
    if (a === b || b === c || a === c) continue;
    // Collapsed duplicates (same three clusters) are dropped as well.
    const lo = Math.min(a, b, c);
    const hi = Math.max(a, b, c);
    const key = (lo * n + (a + b + c - lo - hi)) * n + hi;
    if (seen.has(key)) continue;
    seen.add(key);
    tri[t++] = a;
    tri[t++] = b;
    tri[t++] = c;
    if (i % 3072 === 0 && over()) setDeadline(yield);
  }
  return { pos: out, idx: tri.slice(0, t) };
}

// Removes triangles lying on (and facing like) a detected plane.
function* dropCovered(pos, idx, covers, over, setDeadline) {
  const out = new Uint32Array(idx.length);
  let t = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const cx = (pos[a] + pos[b] + pos[c]) / 3;
    const cy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
    const cz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    let covered = false;
    for (let k = 0; k < covers.length && !covered; k++) {
      const cv = covers[k];
      const pn = cv.normal;
      if (Math.abs(nx * pn.x + ny * pn.y + nz * pn.z) < 0.8) continue;
      const e = cv.inv.elements;
      const ly = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
      if (ly > PLANE_EPS || ly < -PLANE_EPS) continue;
      const lx = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
      if (lx < cv.minX || lx > cv.maxX) continue;
      const lz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
      if (lz < cv.minZ || lz > cv.maxZ) continue;
      covered = true;
    }
    if (!covered) {
      out[t++] = idx[i];
      out[t++] = idx[i + 1];
      out[t++] = idx[i + 2];
    }
    if (i % 1536 === 0 && over()) setDeadline(yield);
  }
  return out.slice(0, t);
}
