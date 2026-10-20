// Visual representation of pieces: instanced pools for the many small dynamic
// pieces, individual meshes for the few static contraptions.

import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIM, SEESAW_TILT, rampSlopeAngle } from '../core/pieceDefs.js';
import { barrelTextures, dominoTextures, pinTextures, triggerTexture } from './textures.js';

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3(1, 1, 1);
const _zero = new Vector3(0, 0, 0);
const _qa = [0, 0, 0, 1];
const _c = new Color();
const _white = new Color(1, 1, 1);

function tintEmissiveByInstance(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif',
    );
  };
  material.customProgramCacheKey = () => 'tint-emissive';
  return material;
}

class InstancePool {
  constructor(scene, geometry, material, capacity) {
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.capacity = capacity;
    this.owners = [];
    scene.add(this.mesh);
  }

  add(piece) {
    if (this.mesh.count >= this.capacity) return -1;
    const i = this.mesh.count++;
    this.owners[i] = piece;
    return i;
  }

  remove(index) {
    const last = this.mesh.count - 1;
    if (index !== last && last >= 0) {
      const moved = this.owners[last];
      this.owners[index] = moved;
      moved.view.index = index;
      this.mesh.getMatrixAt(last, _m);
      this.mesh.setMatrixAt(index, _m);
      this.mesh.getColorAt(last, _c);
      this.mesh.setColorAt(index, _c);
    }
    this.owners.length = last;
    this.mesh.count = Math.max(0, last);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

function pinGeometry() {
  const pts = [
    [0, 0],
    [0.011, 0],
    [0.0155, 0.012],
    [0.0165, 0.03],
    [0.0145, 0.046],
    [0.0092, 0.06],
    [0.0076, 0.066],
    [0.0098, 0.075],
    [0.0116, 0.082],
    [0.0104, 0.09],
    [0.006, 0.094],
    [0, 0.095],
  ].map(([r, y]) => new Vector2(r, y));
  return new LatheGeometry(pts, 18);
}

function rampWedgeGeometry() {
  const { len, w, rise, flat } = DIM.ramp;
  const z0 = -len / 2;
  const zf = z0 + flat;
  const z1 = len / 2;
  const shape = new Shape();
  shape.moveTo(z0, 0);
  shape.lineTo(z1, 0);
  shape.lineTo(zf, rise);
  shape.lineTo(z0, rise);
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);
  g.translate(w / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

function seesawBaseGeometry() {
  const { w, pivot } = DIM.seesaw;
  const r = pivot / 1.5;
  const g = new CylinderGeometry(r, r, w, 3);
  g.rotateZ(Math.PI / 2);
  // Rotate the prism so one edge points straight up.
  g.rotateX(-Math.PI / 2);
  g.translate(0, r / 2, 0);
  return g;
}

const GHOST_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * p;
  vN = normalize(normalMatrix * n);
  vV = normalize(-mv.xyz);
  vH = position.y;
  gl_Position = projectionMatrix * mv;
}`;

const GHOST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float scan = 0.5 + 0.5 * sin(vH * 260.0 - uTime * 6.0);
  float a = 0.18 + f * 0.75 + scan * 0.12;
  gl_FragColor = vec4(uColor * a, a);
}`;

export function createGhostMaterial() {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(0.2, 0.95, 1.0) }, uTime: { value: 0 } },
    vertexShader: GHOST_VERT,
    fragmentShader: GHOST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

export class PieceViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.flashing = new Set();
    this.pulsing = new Set();
    this.time = 0;

    const { w, h, d } = DIM.domino;
    const dominoGeo = new RoundedBoxGeometry(w, h, d, 2, 0.0025);
    dominoGeo.translate(0, h / 2, 0);
    const dt = dominoTextures();
    this.dominoMat = tintEmissiveByInstance(
      new MeshStandardMaterial({
        map: dt.map,
        emissiveMap: dt.emissiveMap,
        emissive: 0xffffff,
        emissiveIntensity: 0.9,
        roughness: 0.32,
        metalness: 0.08,
      }),
    );

    const marbleGeo = new SphereGeometry(DIM.marble.r, 20, 14);
    this.marbleMat = tintEmissiveByInstance(
      new MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.08, metalness: 0.1 }),
    );

    const triggerGeo = new SphereGeometry(DIM.trigger.r, 32, 20);
    this.triggerMat = new MeshStandardMaterial({
      color: 0x8ff8ff,
      emissive: 0x2fe8ff,
      emissiveMap: triggerTexture(),
      emissiveIntensity: 1.6,
      roughness: 0.15,
      metalness: 0.2,
    });

    const pt = pinTextures();
    this.pinMat = tintEmissiveByInstance(
      new MeshStandardMaterial({
        map: pt.map,
        emissiveMap: pt.emissiveMap,
        emissive: 0xffffff,
        emissiveIntensity: 1.6,
        roughness: 0.18,
        metalness: 0.0,
      }),
    );

    const barrelGeo = new CylinderGeometry(DIM.barrel.r, DIM.barrel.r * 0.96, DIM.barrel.h, 24, 1);
    barrelGeo.translate(0, DIM.barrel.h / 2, 0);
    const bt = barrelTextures();
    this.barrelMat = new MeshStandardMaterial({
      map: bt.map,
      emissiveMap: bt.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 1.2,
      roughness: 0.35,
      metalness: 0.45,
    });

    this.geometries = {
      domino: dominoGeo,
      marble: marbleGeo,
      trigger: triggerGeo,
      pin: pinGeometry(),
      barrel: barrelGeo,
    };

    this.pools = {
      domino: new InstancePool(scene, dominoGeo, this.dominoMat, 900),
      marble: new InstancePool(scene, marbleGeo, this.marbleMat, 96),
      trigger: new InstancePool(scene, triggerGeo, this.triggerMat, 8),
      pin: new InstancePool(scene, this.geometries.pin, this.pinMat, 160),
      barrel: new InstancePool(scene, barrelGeo, this.barrelMat, 48),
    };

    // Static contraption parts
    this.rampWedge = rampWedgeGeometry();
    this.rampMat = new MeshStandardMaterial({ color: 0x1a2140, roughness: 0.22, metalness: 0.55 });
    this.neonCyan = new MeshStandardMaterial({ color: 0x0a2b33, emissive: 0x29f0ff, emissiveIntensity: 2.0 });
    this.neonMagenta = new MeshStandardMaterial({ color: 0x33102b, emissive: 0xff3df0, emissiveIntensity: 2.2 });
    this.neonAmber = new MeshStandardMaterial({ color: 0x3a2400, emissive: 0xffa31a, emissiveIntensity: 1.2 });
    this.edgeMat = new LineBasicMaterial({ color: 0x5ff6ff, transparent: true, opacity: 0.85, toneMapped: false });
    this.darkMetal = new MeshStandardMaterial({ color: 0x20232e, roughness: 0.3, metalness: 0.8 });
    this.whiteGloss = new MeshStandardMaterial({ color: 0xf2f4ff, roughness: 0.15, metalness: 0.05 });
    this.plankMat = new MeshStandardMaterial({ color: 0xffb547, roughness: 0.35, metalness: 0.1, emissive: 0xff7a00, emissiveIntensity: 0.15 });
    this.bumperBody = new CylinderGeometry(DIM.bumper.r * 1.05, DIM.bumper.r * 1.12, DIM.bumper.h * 0.55, 28);
    this.bumperBody.translate(0, (DIM.bumper.h * 0.55) / 2, 0);
    this.bumperCap = new CylinderGeometry(DIM.bumper.r * 0.82, DIM.bumper.r * 0.9, DIM.bumper.h * 0.5, 28);
    this.bumperCap.translate(0, DIM.bumper.h * 0.75, 0);
    this.bumperRing = new TorusGeometry(DIM.bumper.r * 0.98, 0.006, 8, 40);
    this.bumperRing.rotateX(Math.PI / 2);
    this.bumperRing.translate(0, DIM.bumper.h * 0.6, 0);
    this.seesawBase = seesawBaseGeometry();
    this.seesawPlank = new BoxGeometry(DIM.seesaw.w, DIM.seesaw.t, DIM.seesaw.len);
    this.seesawStripe = new BoxGeometry(DIM.seesaw.w * 0.15, 0.0015, DIM.seesaw.len * 0.92);
    this.seesawStripe.translate(0, DIM.seesaw.t / 2 + 0.0008, 0);

    this.ghostGeometries = this._buildGhostGeometries();

    sim.on('add', (p) => this.add(p));
    sim.on('remove', (p) => this.remove(p));
  }

  _buildGhostGeometries() {
    const { w, len } = DIM.seesaw;
    const plank = new BoxGeometry(w, DIM.seesaw.t, len);
    plank.rotateX(SEESAW_TILT);
    plank.translate(0, DIM.seesaw.pivot + DIM.seesaw.t / 2, 0);
    const base = this.seesawBase.clone();
    const bumper = new CylinderGeometry(DIM.bumper.r, DIM.bumper.r, DIM.bumper.h, 24);
    bumper.translate(0, DIM.bumper.h / 2, 0);
    return {
      domino: this.geometries.domino,
      line: this.geometries.domino,
      marble: this.geometries.marble,
      trigger: this.geometries.trigger,
      pin: this.geometries.pin,
      barrel: this.geometries.barrel,
      ramp: this.rampWedge,
      bumper,
      seesaw: mergeGeometries([stripForMerge(base), stripForMerge(plank)]),
    };
  }

  baseColor(piece, out) {
    switch (piece.type) {
      case 'domino':
        return out.setHSL(piece.hue, 0.85, 0.56);
      case 'marble':
        return out.setHSL(piece.hue, 0.95, 0.6);
      case 'pin':
        return out.setRGB(1, 1, 1);
      default:
        return out.setRGB(1, 1, 1);
    }
  }

  add(piece) {
    const pool = this.pools[piece.type];
    if (pool) {
      const index = pool.add(piece);
      piece.view = { pool, index, flash: 0 };
      if (index < 0) {
        piece.view.pool = null;
        return;
      }
      pool.mesh.setColorAt(index, this.baseColor(piece, _c));
      pool.mesh.instanceColor.needsUpdate = true;
      return;
    }
    const group = new Group();
    let plank = null;
    let pulse = null;
    if (piece.type === 'ramp') {
      const wedge = new Mesh(this.rampWedge, this.rampMat);
      wedge.castShadow = true;
      wedge.receiveShadow = true;
      group.add(wedge);
      group.add(new LineSegments(new EdgesGeometry(this.rampWedge, 25), this.edgeMat));
      const { len, w, rise, flat, rail } = DIM.ramp;
      const phi = rampSlopeAngle();
      const zf = -len / 2 + flat;
      const slopeLen = Math.hypot(len / 2 - zf, rise);
      for (const sx of [-1, 1]) {
        const railFlat = new Mesh(new BoxGeometry(0.004, 0.004, flat), this.neonCyan);
        railFlat.position.set(sx * (w / 2 + 0.003), rise + rail - 0.002, -len / 2 + flat / 2);
        group.add(railFlat);
        const railSlope = new Mesh(new BoxGeometry(0.004, 0.004, slopeLen), this.neonCyan);
        railSlope.rotation.x = phi;
        railSlope.position.set(sx * (w / 2 + 0.003), rise / 2 + Math.cos(phi) * (rail - 0.002), (zf + len / 2) / 2 + Math.sin(phi) * (rail - 0.002));
        group.add(railSlope);
        const wall = new Mesh(new BoxGeometry(0.006, rise + rail, flat), this.rampMat);
        wall.position.set(sx * (w / 2 + 0.003), (rise + rail) / 2, -len / 2 + flat / 2);
        group.add(wall);
      }
      const back = new Mesh(new BoxGeometry(w + 0.012, rise + rail, 0.006), this.rampMat);
      back.position.set(0, (rise + rail) / 2, -len / 2 - 0.003);
      back.castShadow = true;
      group.add(back);
    } else if (piece.type === 'bumper') {
      const body = new Mesh(this.bumperBody, this.darkMetal);
      body.castShadow = true;
      group.add(body);
      const cap = new Mesh(this.bumperCap, this.whiteGloss);
      cap.castShadow = true;
      group.add(cap);
      pulse = new Mesh(this.bumperRing, this.neonMagenta);
      group.add(pulse);
    } else if (piece.type === 'seesaw') {
      const base = new Mesh(this.seesawBase, this.darkMetal);
      base.castShadow = true;
      group.add(base);
      plank = new Group();
      const board = new Mesh(this.seesawPlank, this.plankMat);
      board.castShadow = true;
      board.receiveShadow = true;
      plank.add(board);
      plank.add(new Mesh(this.seesawStripe, this.neonAmber));
      this.scene.add(plank);
    }
    this.scene.add(group);
    piece.view = { object: group, plank, pulse, pulseT: 0, flash: 0 };
  }

  remove(piece) {
    const v = piece.view;
    if (!v) return;
    if (v.pool) v.pool.remove(v.index);
    if (v.object) {
      this.scene.remove(v.object);
      v.object.traverse((o) => {
        if (o.isLineSegments) o.geometry.dispose();
      });
    }
    if (v.plank) this.scene.remove(v.plank);
    this.flashing.delete(piece);
    this.pulsing.delete(piece);
    piece.view = null;
  }

  flash(piece) {
    if (!piece.view) return;
    piece.view.flash = 1;
    this.flashing.add(piece);
  }

  pulse(piece) {
    if (!piece.view || !piece.view.pulse) return;
    piece.view.pulseT = 1;
    this.pulsing.add(piece);
  }

  update(alpha, dt) {
    this.time += dt;
    const pieces = this.sim.pieces;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const v = p.view;
      if (!v) continue;
      const buf = p.interp[0];
      _p.set(
        buf[0] + (buf[7] - buf[0]) * alpha,
        buf[1] + (buf[8] - buf[1]) * alpha,
        buf[2] + (buf[9] - buf[2]) * alpha,
      );
      Quaternion.slerpFlat(_qa, 0, buf, 3, buf, 10, alpha);
      _q.fromArray(_qa);
      if (v.pool) {
        _m.compose(_p, _q, p.hidden ? _zero : _s);
        v.pool.mesh.setMatrixAt(v.index, _m);
      } else if (v.object) {
        v.object.position.copy(_p);
        v.object.quaternion.copy(_q);
        if (v.plank && p.interp[1]) {
          const b = p.interp[1];
          v.plank.position.set(b[0] + (b[7] - b[0]) * alpha, b[1] + (b[8] - b[1]) * alpha, b[2] + (b[9] - b[2]) * alpha);
          Quaternion.slerpFlat(_qa, 0, b, 3, b, 10, alpha);
          v.plank.quaternion.fromArray(_qa);
        }
      }
    }
    for (const key in this.pools) {
      const pool = this.pools[key];
      if (pool.mesh.count > 0) pool.mesh.instanceMatrix.needsUpdate = true;
    }

    if (this.flashing.size) {
      for (const p of this.flashing) {
        const v = p.view;
        v.flash = Math.max(0, v.flash - dt * 2.2);
        if (v.pool) {
          this.baseColor(p, _c).lerp(_white, v.flash * 0.75).multiplyScalar(1 + v.flash * 1.8);
          v.pool.mesh.setColorAt(v.index, _c);
          v.pool.mesh.instanceColor.needsUpdate = true;
        }
        if (v.flash <= 0) this.flashing.delete(p);
      }
    }
    if (this.pulsing.size) {
      for (const p of this.pulsing) {
        const v = p.view;
        v.pulseT = Math.max(0, v.pulseT - dt * 4);
        const s = 1 + Math.sin((1 - v.pulseT) * Math.PI) * 0.25;
        v.pulse.scale.set(s, 1, s);
        if (v.pulseT <= 0) this.pulsing.delete(p);
      }
    }
    this.triggerMat.emissiveIntensity = 1.3 + Math.sin(this.time * 4) * 0.5;
  }

  // Restores base colours (after a reset).
  refreshColors() {
    for (const p of this.sim.pieces) {
      const v = p.view;
      if (v && v.pool) {
        v.flash = 0;
        v.pool.mesh.setColorAt(v.index, this.baseColor(p, _c));
        v.pool.mesh.instanceColor.needsUpdate = true;
      }
    }
    this.flashing.clear();
  }
}

function stripForMerge(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  return g;
}

