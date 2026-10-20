// Physics world, piece registry and chain-reaction rules (bumpers, explosions,
// topple detection, run lifecycle). Rendering and audio subscribe via events.

import { Quaternion, Vector3 } from 'three';
import { buildPiecePhysics, DIM, PIECE_INFO, extraBodyPose } from './pieceDefs.js';

export const FIXED_DT = 1 / 120;
const MAX_STEPS = 5;
const TOPPLE_COS = Math.cos((32 * Math.PI) / 180);
const TRIGGER_SPEED = 0.95;
const EXPLOSION_RADIUS = 0.36;
const BUMPER_KICK = 1.15;

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q1 = new Quaternion();
const _tmpVec = { x: 0, y: 0, z: 0 };
const _tmpRot = { x: 0, y: 0, z: 0, w: 1 };

function upFromQuat(q, out) {
  const { x, y, z, w } = q;
  return out.set(2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x));
}

export class Simulation {
  constructor(R) {
    this.R = R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    try {
      this.world.integrationParameters.lengthUnit = 0.1;
    } catch {
      /* older builds lack lengthUnit */
    }
    this.events = new R.EventQueue(true);
    this.pieces = [];
    this.owner = new Map();
    this.listeners = new Map();
    this.nextId = 1;
    this.simTime = 0;
    this.accumulator = 0;
    this.alpha = 0;
    this.stepCount = 0;
    this.phase = 'build';
    this.runStart = 0;
    this.lastActivation = 0;
    this.pendingExplosions = [];
    this.onStep = null;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.surfaceFilter = (collider) => {
      const p = this.owner.get(collider.handle);
      return !p || !p.info.dynamic;
    };
    this.pieceFilter = (collider) => {
      const p = this.owner.get(collider.handle);
      return !!p && !p.removed;
    };
    this.excludePiece = null;
    this.surfaceFilterExcluding = (collider) => {
      const p = this.owner.get(collider.handle);
      if (p && p === this.excludePiece) return false;
      return !p || !p.info.dynamic;
    };
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  emit(type, data) {
    const list = this.listeners.get(type);
    if (list) for (let i = 0; i < list.length; i++) list[i](data);
  }

  // ---------------------------------------------------------------- statics
  addStaticBox(pos, quat, hx, hy, hz, friction = 0.6) {
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }),
    );
    this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction).setRestitution(0.2), body);
    return body;
  }

  addStaticTrimesh(pos, quat, vertices, indices) {
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }),
    );
    try {
      this.world.createCollider(R.ColliderDesc.trimesh(vertices, indices).setFriction(0.6).setRestitution(0.2), body);
    } catch (err) {
      console.warn('Trimesh collider rejected', err);
    }
    return body;
  }

  removeStatic(body) {
    if (body) this.world.removeRigidBody(body);
  }

  // ----------------------------------------------------------------- pieces
  addPiece(type, pos, quat, extra = {}) {
    const info = PIECE_INFO[type];
    const phys = buildPiecePhysics(this.R, this.world, type, pos, quat);
    const piece = {
      id: this.nextId++,
      type,
      info,
      bodies: phys.bodies,
      colliders: phys.colliders,
      joints: phys.joints,
      home: { pos: pos.clone(), quat: quat.clone() },
      startUp: new Vector3(),
      startPos: pos.clone(),
      plankStart: new Quaternion(),
      toppled: false,
      exploded: false,
      held: false,
      removed: false,
      bumpCooldown: 0,
      hue: extra.hue ?? Math.random(),
      // Interpolation buffers: per body [prevPos3, prevQuat4, curPos3, curQuat4]
      interp: phys.bodies.map(() => new Float32Array(14)),
      userData: {},
    };
    for (const c of phys.colliders) this.owner.set(c.handle, piece);
    this.pieces.push(piece);
    this._captureInterp(piece, true);
    this._captureStart(piece);
    this.emit('add', piece);
    return piece;
  }

  removePiece(piece) {
    if (piece.removed) return;
    piece.removed = true;
    for (const c of piece.colliders) this.owner.delete(c.handle);
    for (let i = piece.bodies.length - 1; i >= 0; i--) this.world.removeRigidBody(piece.bodies[i]);
    const idx = this.pieces.indexOf(piece);
    if (idx >= 0) this.pieces.splice(idx, 1);
    this.emit('remove', piece);
  }

  clearPieces() {
    while (this.pieces.length) this.removePiece(this.pieces[this.pieces.length - 1]);
    this.phase = 'build';
    this.pendingExplosions.length = 0;
    this.emit('cleared');
  }

  pieceFromCollider(collider) {
    return this.owner.get(collider.handle);
  }

  piecePosition(piece, out) {
    const t = piece.bodies[0].translation();
    return out.set(t.x, t.y, t.z);
  }

  pieceQuaternion(piece, out) {
    const r = piece.bodies[0].rotation();
    return out.set(r.x, r.y, r.z, r.w);
  }

  _captureStart(piece) {
    const r = piece.bodies[0].rotation();
    _q1.set(r.x, r.y, r.z, r.w);
    upFromQuat(_q1, piece.startUp);
    const t = piece.bodies[0].translation();
    piece.startPos.set(t.x, t.y, t.z);
    if (piece.type === 'seesaw' && piece.bodies[1]) {
      const pr = piece.bodies[1].rotation();
      piece.plankStart.set(pr.x, pr.y, pr.z, pr.w);
    }
  }

  _captureInterp(piece, both) {
    for (let i = 0; i < piece.bodies.length; i++) {
      const b = piece.bodies[i];
      const buf = piece.interp[i];
      if (!both && b.isSleeping() && !piece.held) {
        buf.copyWithin(0, 7, 14);
        continue;
      }
      buf.copyWithin(0, 7, 14);
      const t = b.translation();
      const r = b.rotation();
      buf[7] = t.x;
      buf[8] = t.y;
      buf[9] = t.z;
      buf[10] = r.x;
      buf[11] = r.y;
      buf[12] = r.z;
      buf[13] = r.w;
      if (both) buf.copyWithin(0, 7, 14);
    }
  }

  // ------------------------------------------------------------ holding
  holdPiece(piece) {
    const R = this.R;
    piece.held = true;
    piece.bodies[0].setBodyType(R.RigidBodyType.KinematicPositionBased, true);
    for (const b of piece.bodies) b.wakeUp();
  }

  setHeldTarget(piece, pos, quat) {
    const b = piece.bodies[0];
    _tmpVec.x = pos.x;
    _tmpVec.y = pos.y;
    _tmpVec.z = pos.z;
    _tmpRot.x = quat.x;
    _tmpRot.y = quat.y;
    _tmpRot.z = quat.z;
    _tmpRot.w = quat.w;
    b.setNextKinematicTranslation(_tmpVec);
    b.setNextKinematicRotation(_tmpRot);
  }

  releasePiece(piece, linvel, angvel) {
    const R = this.R;
    piece.held = false;
    const b = piece.bodies[0];
    const isTriggerIdle = piece.type === 'trigger' && this.phase !== 'run';
    if (!piece.info.dynamic) {
      b.setBodyType(R.RigidBodyType.Fixed, true);
    } else if (isTriggerIdle) {
      b.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
    } else {
      b.setBodyType(R.RigidBodyType.Dynamic, true);
      if (linvel) b.setLinvel({ x: linvel.x, y: linvel.y, z: linvel.z }, true);
      if (angvel) b.setAngvel({ x: angvel.x, y: angvel.y, z: angvel.z }, true);
    }
    for (const body of piece.bodies) body.wakeUp();
    // A moved piece becomes part of the layout while building.
    if (this.phase === 'build') this._rememberHome(piece);
  }

  _rememberHome(piece) {
    const t = piece.bodies[0].translation();
    const r = piece.bodies[0].rotation();
    piece.home.pos.set(t.x, t.y, t.z);
    piece.home.quat.set(r.x, r.y, r.z, r.w);
  }

  // ---------------------------------------------------------- run control
  start() {
    if (this.phase === 'run') return false;
    if (this.phase === 'done') this.reset(true);
    const R = this.R;
    let hasTrigger = false;
    for (const p of this.pieces) {
      this._rememberHome(p);
      this._captureStart(p);
      p.toppled = false;
      p.exploded = false;
      if (p.type === 'trigger' && !p.held) {
        hasTrigger = true;
        const b = p.bodies[0];
        b.setBodyType(R.RigidBodyType.Dynamic, true);
        const r = b.rotation();
        _q1.set(r.x, r.y, r.z, r.w);
        _v1.set(0, 0, 1).applyQuaternion(_q1);
        _v1.y = 0;
        _v1.normalize().multiplyScalar(TRIGGER_SPEED);
        b.setLinvel({ x: _v1.x, y: 0, z: _v1.z }, true);
        b.setAngvel({ x: _v1.z / DIM.trigger.r, y: 0, z: -_v1.x / DIM.trigger.r }, true);
      }
    }
    this.phase = 'run';
    this.runStart = this.simTime;
    this.lastActivation = this.simTime;
    this.emit('start', { hasTrigger });
    return true;
  }

  reset(silent = false) {
    const R = this.R;
    this.pendingExplosions.length = 0;
    for (const p of this.pieces) {
      if (p.held) continue;
      const base = p.bodies[0];
      const { pos, quat } = p.home;
      if (p.type === 'trigger') base.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
      base.setEnabled(true);
      base.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
      base.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
      if (base.isDynamic()) {
        base.setLinvel({ x: 0, y: 0, z: 0 }, true);
        base.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      for (let i = 1; i < p.bodies.length; i++) {
        const b = p.bodies[i];
        extraBodyPose(p.type, i, pos, quat, _v1, _q1);
        b.setTranslation({ x: _v1.x, y: _v1.y, z: _v1.z }, true);
        b.setRotation({ x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      p.toppled = false;
      p.exploded = false;
      this._captureInterp(p, true);
      this._captureStart(p);
    }
    this.phase = 'build';
    if (!silent) this.emit('reset');
  }

  // ------------------------------------------------------------- stepping
  advance(dt, timeScale) {
    this.accumulator += Math.min(dt, 0.1) * timeScale;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
      this.step();
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS && this.accumulator > FIXED_DT) this.accumulator = FIXED_DT * 0.5;
    this.alpha = this.accumulator / FIXED_DT;
    return steps;
  }

  step() {
    this.world.step(this.events);
    this.simTime += FIXED_DT;
    this.stepCount++;
    this.events.drainCollisionEvents(this._collisionHandler || (this._collisionHandler = (h1, h2, started) => {
      if (started) this._onCollision(h1, h2);
    }));

    if (this.pendingExplosions.length) {
      for (let i = this.pendingExplosions.length - 1; i >= 0; i--) {
        const e = this.pendingExplosions[i];
        if (this.simTime >= e.time) {
          this.pendingExplosions.splice(i, 1);
          this._explode(e.piece);
        }
      }
    }

    const pieces = this.pieces;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.bumpCooldown > 0) p.bumpCooldown -= FIXED_DT;
      this._captureInterp(p, false);
    }

    if (this.phase === 'run') this._detectTopples();

    if ((this.stepCount & 31) === 0) this._cullFallen();

    if (this.onStep) this.onStep();
  }

  _detectTopples() {
    let total = 0;
    let done = 0;
    for (const p of this.pieces) {
      if (!p.info.scorable) continue;
      total++;
      if (p.toppled) {
        done++;
        continue;
      }
      let hit = false;
      const buf = p.interp[0];
      if (p.type === 'marble') {
        _v1.set(buf[7], buf[8], buf[9]);
        hit = _v1.distanceTo(p.startPos) > 0.05;
      } else if (p.type === 'barrel') {
        hit = p.exploded;
        if (!hit) {
          _q1.set(buf[10], buf[11], buf[12], buf[13]);
          hit = upFromQuat(_q1, _v1).dot(p.startUp) < TOPPLE_COS;
        }
      } else if (p.type === 'seesaw') {
        const pb = p.interp[1];
        _q1.set(pb[10], pb[11], pb[12], pb[13]);
        hit = Math.abs(_q1.angleTo(p.plankStart)) > 0.2;
      } else {
        _q1.set(buf[10], buf[11], buf[12], buf[13]);
        hit = upFromQuat(_q1, _v1).dot(p.startUp) < TOPPLE_COS;
      }
      if (hit) {
        p.toppled = true;
        done++;
        this.lastActivation = this.simTime;
        this.emit('topple', p);
      }
    }
    const idle = this.simTime - this.lastActivation;
    const elapsed = this.simTime - this.runStart;
    const allDone = total > 0 && done === total && idle > 0.9;
    if ((idle > 3 && elapsed > 2) || allDone || elapsed > 90) {
      this.phase = 'done';
      this.emit('runEnd', { toppled: done, total, perfect: total > 0 && done === total, duration: elapsed });
    }
  }

  _cullFallen() {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      if (p.held) continue;
      const y = p.interp[0][8];
      if (y < -4) {
        if (this.phase === 'build') this.removePiece(p);
        else if (p.bodies[0].isEnabled()) p.bodies[0].setEnabled(false);
      }
    }
  }

  _bodyVelocity(collider, out) {
    const body = collider.parent();
    if (!body || !body.isDynamic()) return out.set(0, 0, 0);
    const v = body.linvel();
    return out.set(v.x, v.y, v.z);
  }

  _onCollision(h1, h2) {
    const c1 = this.world.getCollider(h1);
    const c2 = this.world.getCollider(h2);
    if (!c1 || !c2) return;
    const p1 = this.owner.get(h1);
    const p2 = this.owner.get(h2);
    if (!p1 && !p2) return;
    this._bodyVelocity(c1, _v1);
    this._bodyVelocity(c2, _v2);
    const speed = _v3.subVectors(_v1, _v2).length();

    const a = p1 || p2;
    const b = p1 ? p2 : null;
    const anchor = speed > 0 && _v1.lengthSq() >= _v2.lengthSq() ? c1 : c2;
    const t = anchor.translation();
    this.emit('impact', { a, b, speed, x: t.x, y: t.y, z: t.z });

    if (p1 && p2) {
      this._bumper(p1, p2);
      this._bumper(p2, p1);
    }
    this._barrelHit(p1, p2, speed);
    this._barrelHit(p2, p1, speed);
  }

  _bumper(bumper, other) {
    if (bumper.type !== 'bumper' || !other.info.dynamic || other.held) return;
    if (other.bumpCooldown > 0) return;
    const body = other.bodies[0];
    if (!body.isDynamic()) return;
    other.bumpCooldown = 0.12;
    const bt = bumper.bodies[0].translation();
    const ot = body.translation();
    _v1.set(ot.x - bt.x, 0, ot.z - bt.z);
    if (_v1.lengthSq() < 1e-8) _v1.set(1, 0, 0);
    _v1.normalize();
    const m = body.mass();
    body.applyImpulse({ x: _v1.x * BUMPER_KICK * m, y: 0.12 * m, z: _v1.z * BUMPER_KICK * m }, true);
    this.emit('bump', { piece: bumper, x: bt.x, y: bt.y + DIM.bumper.h, z: bt.z });
  }

  _barrelHit(barrel, other, speed) {
    if (!barrel || barrel.type !== 'barrel' || barrel.exploded || barrel.held) return;
    const dynamicOther = other && other.info.dynamic;
    if ((dynamicOther && speed > 0.07) || speed > 1.4) this.scheduleExplosion(barrel, 0.03);
  }

  scheduleExplosion(barrel, delay) {
    if (barrel.exploded || this.pendingExplosions.some((e) => e.piece === barrel)) return;
    this.pendingExplosions.push({ piece: barrel, time: this.simTime + delay });
  }

  _explode(barrel) {
    if (barrel.exploded || barrel.removed) return;
    barrel.exploded = true;
    const b = barrel.bodies[0];
    const bt = b.translation();
    const cx = bt.x;
    const cy = bt.y + DIM.barrel.h * 0.5;
    const cz = bt.z;
    b.setEnabled(false);
    for (const p of this.pieces) {
      if (p === barrel || p.held) continue;
      for (const body of p.bodies) {
        if (!body.isDynamic() || !body.isEnabled()) continue;
        const t = body.translation();
        _v1.set(t.x - cx, t.y - cy, t.z - cz);
        const dist = _v1.length();
        if (dist > EXPLOSION_RADIUS) continue;
        const falloff = 1 - dist / EXPLOSION_RADIUS;
        if (dist < 1e-4) _v1.set(0, 1, 0);
        _v1.normalize();
        _v1.y += 0.55;
        _v1.normalize();
        const dv = 2.3 * falloff * falloff + 0.25;
        const m = body.mass();
        body.applyImpulse({ x: _v1.x * dv * m, y: _v1.y * dv * m, z: _v1.z * dv * m }, true);
        body.setAngvel({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 12 }, true);
      }
      if (p.type === 'barrel' && !p.exploded) {
        const t = p.bodies[0].translation();
        const d = Math.hypot(t.x - cx, t.z - cz);
        if (d < EXPLOSION_RADIUS * 0.85) this.scheduleExplosion(p, 0.1 + d * 0.5);
      }
    }
    if (this.phase === 'run') this.lastActivation = this.simTime;
    this.emit('explode', { piece: barrel, x: cx, y: cy, z: cz });
  }

  // --------------------------------------------------------------- queries
  castRay(origin, dir, maxDist, mode = 'surface', exclude = null) {
    const ray = this.ray;
    ray.origin.x = origin.x;
    ray.origin.y = origin.y;
    ray.origin.z = origin.z;
    ray.dir.x = dir.x;
    ray.dir.y = dir.y;
    ray.dir.z = dir.z;
    let filter = mode === 'surface' ? this.surfaceFilter : this.pieceFilter;
    if (mode === 'surface' && exclude) {
      this.excludePiece = exclude;
      filter = this.surfaceFilterExcluding;
    }
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, undefined, undefined, filter);
    this.excludePiece = null;
    if (!hit) return null;
    return {
      distance: hit.timeOfImpact,
      normal: hit.normal,
      collider: hit.collider,
      piece: this.owner.get(hit.collider.handle) || null,
    };
  }

  stats() {
    let total = 0;
    let toppled = 0;
    for (const p of this.pieces) {
      if (!p.info.scorable) continue;
      total++;
      if (p.toppled) toppled++;
    }
    return { total, toppled };
  }
}
