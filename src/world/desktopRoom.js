// Stylised virtual living room used for the desktop preview and as the VR
// fallback environment. Every surface is also a static physics collider.

import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  MeshBasicMaterial,
} from 'three';
import { fabricTexture, woodTexture } from '../render/textures.js';

const IDENTITY = new Quaternion();

export class DesktopRoom {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.group = new Group();
    this.bodies = [];
    this.surfaces = [];
    scene.add(this.group);
    this._build();
  }

  _box(w, h, d, x, y, z, mat, { collider = true, cast = true, receive = true } = {}) {
    const m = new Mesh(new BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = receive;
    this.group.add(m);
    if (collider) this.bodies.push(this.sim.addStaticBox(new Vector3(x, y, z), IDENTITY, w / 2, h / 2, d / 2));
    return m;
  }

  _surface(kind, x, y, z, halfU, halfV) {
    this.surfaces.push({
      kind,
      center: new Vector3(x, y, z),
      normal: new Vector3(0, 1, 0),
      quaternion: new Quaternion(),
      halfU,
      halfV,
      area: halfU * halfV * 4,
    });
  }

  _build() {
    const wood = woodTexture(5);
    const floorMat = new MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0.0, color: 0xb7a493 });
    const floor = new Mesh(new PlaneGeometry(9, 9), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.bodies.push(this.sim.addStaticBox(new Vector3(0, -0.1, 0), IDENTITY, 6, 0.1, 6));
    this._surface('floor', 0, 0, 0, 4.5, 4.5);

    const rug = new Mesh(
      new CircleGeometry(1.7, 64),
      new MeshStandardMaterial({ map: fabricTexture(), color: 0x6c7bd6, roughness: 0.95 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.003;
    rug.receiveShadow = true;
    this.group.add(rug);

    const wallMat = new MeshStandardMaterial({ color: 0x232a3d, roughness: 0.9 });
    this._box(9, 3, 0.1, 0, 1.5, -3.2, wallMat, { cast: false });
    this._box(0.1, 3, 9, -3.6, 1.5, 0, wallMat, { cast: false });
    this._box(0.1, 3, 9, 3.6, 1.5, 0, wallMat, { cast: false });

    const neonC = new MeshBasicMaterial({ color: 0x46f2ff, toneMapped: false });
    const neonM = new MeshBasicMaterial({ color: 0xff4fe0, toneMapped: false });
    this._box(6.5, 0.025, 0.025, 0, 2.55, -3.13, neonC, { collider: false, cast: false });
    this._box(0.025, 0.025, 6.5, -3.53, 0.12, 0, neonM, { collider: false, cast: false });
    this._box(0.025, 1.6, 0.025, 2.6, 1.0, -3.13, neonM, { collider: false, cast: false });
    this._box(0.025, 1.2, 0.025, 2.75, 0.8, -3.13, neonC, { collider: false, cast: false });

    // Dining table
    const tableWood = woodTexture(1);
    const topMat = new MeshStandardMaterial({ map: tableWood, color: 0xe2c9a8, roughness: 0.4, metalness: 0.0 });
    const legMat = new MeshStandardMaterial({ color: 0x15171f, roughness: 0.35, metalness: 0.8 });
    const tw = 1.9;
    const td = 1.15;
    const th = 0.76;
    this._box(tw, 0.045, td, 0, th - 0.0225, -0.3, topMat);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this._box(0.05, th - 0.045, 0.05, sx * (tw / 2 - 0.1), (th - 0.045) / 2, -0.3 + sz * (td / 2 - 0.1), legMat, { collider: false });
      }
    }
    this._surface('table', 0, th, -0.3, tw / 2 - 0.02, td / 2 - 0.02);

    // Sofa
    const fabric = new MeshStandardMaterial({ map: fabricTexture(), color: 0x8d97c9, roughness: 0.92 });
    const sx = -2.2;
    const sz = -0.9;
    this._box(0.9, 0.42, 2.1, sx, 0.21, sz, fabric);
    this._box(0.25, 0.5, 2.1, sx - 0.35, 0.67, sz, fabric);
    this._box(0.9, 0.25, 0.22, sx, 0.545, sz - 0.95, fabric);
    this._box(0.9, 0.25, 0.22, sx, 0.545, sz + 0.95, fabric);
    for (let i = 0; i < 2; i++) {
      const cushion = new Mesh(new BoxGeometry(0.6, 0.12, 0.82), fabric);
      cushion.position.set(sx + 0.08, 0.48, sz - 0.42 + i * 0.84);
      cushion.castShadow = true;
      cushion.receiveShadow = true;
      this.group.add(cushion);
    }
    this.bodies.push(this.sim.addStaticBox(new Vector3(sx + 0.08, 0.48, sz), IDENTITY, 0.3, 0.06, 0.83));
    this._surface('sofa', sx + 0.08, 0.54, sz, 0.3, 0.8);

    // Low cabinet
    const cab = new MeshStandardMaterial({ color: 0x3a4058, roughness: 0.35, metalness: 0.2 });
    this._box(1.4, 0.5, 0.45, 2.3, 0.25, -2.6, cab);
    this._surface('cabinet', 2.3, 0.5, -2.6, 0.68, 0.2);

    // Floor lamp
    const lamp = new Group();
    const pole = new Mesh(new CylinderGeometry(0.012, 0.012, 1.6, 12), legMat);
    pole.position.y = 0.8;
    pole.castShadow = true;
    lamp.add(pole);
    const shade = new Mesh(new SphereGeometry(0.16, 24, 16), new MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }));
    shade.position.y = 1.65;
    lamp.add(shade);
    const base = new Mesh(new CylinderGeometry(0.16, 0.18, 0.03, 24), legMat);
    base.position.y = 0.015;
    lamp.add(base);
    lamp.position.set(-2.9, 0, -2.6);
    this.group.add(lamp);

    // Plant pot with a simple stylised shrub
    const pot = new Mesh(new CylinderGeometry(0.16, 0.12, 0.35, 20), new MeshStandardMaterial({ color: 0xd56b4a, roughness: 0.7 }));
    pot.position.set(3.0, 0.175, 0.8);
    pot.castShadow = true;
    this.group.add(pot);
    const leafMat = new MeshStandardMaterial({ color: 0x3fae6a, roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const leaf = new Mesh(new SphereGeometry(0.14 + Math.random() * 0.06, 12, 10), leafMat);
      leaf.position.set(3.0 + (Math.random() - 0.5) * 0.25, 0.5 + Math.random() * 0.35, 0.8 + (Math.random() - 0.5) * 0.25);
      leaf.castShadow = true;
      this.group.add(leaf);
    }
  }

  dispose() {
    for (const b of this.bodies) this.sim.removeStatic(b);
    this.scene.remove(this.group);
  }
}
