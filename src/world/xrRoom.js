// Turns the WebXR room understanding (planes + meshes) into static physics
// colliders, shadow catchers and a holographic scan reveal. Every feature is
// optional: without planes/meshes a floor at y = 0 is used.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  ShadowMaterial,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';

const SCAN_DURATION = 6.5;

const SCAN_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

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
  float a = (band * 1.4 + behind) * uFade;
  gl_FragColor = vec4(uColor * a, 0.0);
}`;

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _c = new Vector3();
const _up = new Vector3();

export class XRRoom {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.planes = new Map();
    this.meshes = new Map();
    this.floorBody = null;
    this.floorCatcher = null;
    this.active = false;
    this.scanTime = 0;
    this.useOcclusionMeshes = false;
    this.planeSupport = false;
    this.meshSupport = false;

    this.shadowMat = new ShadowMaterial({ opacity: 0.38, depthWrite: false, side: DoubleSide });
    this.shadowMat.polygonOffset = true;
    this.shadowMat.polygonOffsetFactor = -2;
    this.shadowMat.polygonOffsetUnits = -2;
    this.occluderMat = new MeshBasicMaterial({ colorWrite: false });
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
      wireframe: true,
    });
    this.scanLineMat = this.scanMat.clone();
    this.scanLineMat.wireframe = false;
    this.scanLineMat.uniforms = this.scanMat.uniforms;
  }

  start(origin, { planes = true, meshes = true } = {}) {
    this.planesEnabled = planes;
    this.meshesEnabled = meshes;
    this.planeSupport = false;
    this.meshSupport = false;
    this.active = true;
    this.scanTime = 0;
    this.scanMat.uniforms.uOrigin.value.copy(origin);
    this.scanMat.uniforms.uFade.value = 1;
    this.floorBody = this.sim.addStaticBox(new Vector3(0, -0.06, 0), new Quaternion(), 25, 0.06, 25);
    const catcher = new Mesh(new CircleGeometry(5, 48), this.shadowMat);
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = 0.002;
    catcher.receiveShadow = true;
    catcher.renderOrder = -1;
    this.scene.add(catcher);
    this.floorCatcher = catcher;
  }

  stop() {
    this.active = false;
    for (const e of this.planes.values()) this._removePlane(e);
    for (const e of this.meshes.values()) this._removeMesh(e);
    this.planes.clear();
    this.meshes.clear();
    if (this.floorBody) this.sim.removeStatic(this.floorBody);
    this.floorBody = null;
    if (this.floorCatcher) {
      this.scene.remove(this.floorCatcher);
      this.floorCatcher.geometry.dispose();
    }
    this.floorCatcher = null;
  }

  update(frame, refSpace, dt) {
    if (!this.active || !frame) return;
    this.scanTime += dt;
    const u = this.scanMat.uniforms;
    u.uTime.value = this.scanTime;
    u.uFade.value = this.scanTime < SCAN_DURATION - 2 ? 1 : Math.max(0, (SCAN_DURATION - this.scanTime) / 2);
    const scanVisible = this.scanTime < SCAN_DURATION;

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
      const seen = new Set();
      planes.forEach((plane) => {
        seen.add(plane);
        let e = this.planes.get(plane);
        if (!e || e.lastChanged !== plane.lastChangedTime) {
          const pose = frame.getPose(plane.planeSpace, refSpace);
          if (!pose) return;
          if (e) this._removePlane(e);
          e = this._buildPlane(plane, pose);
          if (e) this.planes.set(plane, e);
        }
        if (e && e.scan) e.scan.visible = scanVisible;
      });
      for (const [plane, e] of this.planes) {
        if (!seen.has(plane)) {
          this._removePlane(e);
          this.planes.delete(plane);
        }
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
      const seen = new Set();
      meshes.forEach((mesh) => {
        seen.add(mesh);
        let e = this.meshes.get(mesh);
        if (!e || e.lastChanged !== mesh.lastChangedTime) {
          const pose = frame.getPose(mesh.meshSpace, refSpace);
          if (!pose) return;
          if (e) this._removeMesh(e);
          e = this._buildMesh(mesh, pose);
          if (e) this.meshes.set(mesh, e);
        }
        if (e && e.scan) e.scan.visible = scanVisible;
      });
      for (const [mesh, e] of this.meshes) {
        if (!seen.has(mesh)) {
          this._removeMesh(e);
          this.meshes.delete(mesh);
        }
      }
    }

    // Hide the big fallback shadow disc once a real floor plane is known.
    if (this.floorCatcher) {
      let hasFloor = false;
      for (const e of this.planes.values()) if (e.surface && e.surface.kind === 'floor') hasFloor = true;
      this.floorCatcher.visible = !hasFloor;
    }
  }

  _buildPlane(plane, pose) {
    const poly = plane.polygon;
    if (!poly || poly.length < 3) return null;
    _m.fromArray(pose.transform.matrix);
    _m.decompose(_p, _q, _s);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const shape = new Shape();
    for (let i = 0; i < poly.length; i++) {
      const pt = poly[i];
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minZ = Math.min(minZ, pt.z);
      maxZ = Math.max(maxZ, pt.z);
      if (i === 0) shape.moveTo(pt.x, -pt.z);
      else shape.lineTo(pt.x, -pt.z);
    }
    const hx = Math.max(0.01, (maxX - minX) / 2);
    const hz = Math.max(0.01, (maxZ - minZ) / 2);
    const thick = 0.035;
    _c.set((minX + maxX) / 2, -thick, (minZ + maxZ) / 2).applyMatrix4(_m);
    const body = this.sim.addStaticBox(_c.clone(), _q.clone(), hx, thick, hz);

    const geo = new ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.002, 0);
    const catcher = new Mesh(geo, this.shadowMat);
    catcher.matrixAutoUpdate = false;
    catcher.matrix.copy(_m);
    catcher.receiveShadow = true;
    catcher.renderOrder = -1;
    this.scene.add(catcher);

    // Outline used by the scan sweep.
    const outline = new BufferGeometry();
    const arr = new Float32Array(poly.length * 3);
    for (let i = 0; i < poly.length; i++) {
      arr[i * 3] = poly[i].x;
      arr[i * 3 + 1] = 0.003;
      arr[i * 3 + 2] = poly[i].z;
    }
    outline.setAttribute('position', new BufferAttribute(arr, 3));
    const scan = new LineLoop(outline, this.scanLineMat);
    scan.matrixAutoUpdate = false;
    scan.matrix.copy(_m);
    scan.renderOrder = 5;
    scan.frustumCulled = false;
    this.scene.add(scan);

    _up.set(0, 1, 0).applyQuaternion(_q);
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
    return { body, catcher, scan, surface, lastChanged: plane.lastChangedTime };
  }

  _removePlane(e) {
    this.sim.removeStatic(e.body);
    this.scene.remove(e.catcher);
    e.catcher.geometry.dispose();
    this.scene.remove(e.scan);
    e.scan.geometry.dispose();
  }

  _buildMesh(mesh, pose) {
    const vertices = mesh.vertices;
    const indices = mesh.indices;
    if (!vertices || !indices || indices.length < 3) return null;
    _m.fromArray(pose.transform.matrix);
    _m.decompose(_p, _q, _s);
    const v = new Float32Array(vertices);
    const idx = new Uint32Array(indices);
    const body = this.sim.addStaticTrimesh(_p.clone(), _q.clone(), v, idx);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(v, 3));
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    const scan = new Mesh(geo, this.scanMat);
    scan.matrixAutoUpdate = false;
    scan.matrix.copy(_m);
    scan.renderOrder = 5;
    scan.frustumCulled = false;
    this.scene.add(scan);

    let occluder = null;
    if (this.useOcclusionMeshes) {
      occluder = new Mesh(geo, this.occluderMat);
      occluder.matrixAutoUpdate = false;
      occluder.matrix.copy(_m);
      occluder.renderOrder = -2;
      this.scene.add(occluder);
    }
    // Without planes the room mesh doubles as shadow receiver.
    let catcher = null;
    if (!this.planeSupport || this.planes.size === 0) {
      catcher = new Mesh(geo, this.shadowMat);
      catcher.matrixAutoUpdate = false;
      catcher.matrix.copy(_m);
      catcher.receiveShadow = true;
      catcher.renderOrder = -1;
      this.scene.add(catcher);
    }
    return { body, scan, occluder, catcher, geo, lastChanged: mesh.lastChangedTime };
  }

  _removeMesh(e) {
    this.sim.removeStatic(e.body);
    this.scene.remove(e.scan);
    if (e.occluder) this.scene.remove(e.occluder);
    if (e.catcher) this.scene.remove(e.catcher);
    e.geo.dispose();
  }

  setOcclusionMeshes(enabled) {
    if (this.useOcclusionMeshes === enabled) return;
    this.useOcclusionMeshes = enabled;
    for (const e of this.meshes.values()) {
      if (enabled && !e.occluder) {
        e.occluder = new Mesh(e.geo, this.occluderMat);
        e.occluder.matrixAutoUpdate = false;
        e.occluder.matrix.copy(e.scan.matrix);
        e.occluder.renderOrder = -2;
        this.scene.add(e.occluder);
      } else if (!enabled && e.occluder) {
        this.scene.remove(e.occluder);
        e.occluder = null;
      }
    }
  }

  get surfaces() {
    const out = [];
    for (const e of this.planes.values()) if (e.surface) out.push(e.surface);
    return out;
  }

  get summary() {
    return { planes: this.planes.size, meshes: this.meshes.size, planeSupport: this.planeSupport, meshSupport: this.meshSupport };
  }
}
