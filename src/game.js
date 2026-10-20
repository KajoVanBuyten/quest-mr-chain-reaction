// Game layer: tools, placement, grabbing, scoring, presets, replay and the
// glue between simulation events and visuals/audio.

import {
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  DynamicDrawUsage,
  RingGeometry,
  MeshBasicMaterial,
  AdditiveBlending,
} from 'three';
import { DIM, PIECE_INFO, spawnLift } from './core/pieceDefs.js';
import { LEVELS, basisQuaternion, levelBounds, placeLevel } from './core/levels.js';
import { Recorder } from './core/replay.js';
import { FIXED_DT } from './core/simulation.js';
import { createGhostMaterial } from './render/pieceViews.js';

const UP = new Vector3(0, 1, 0);
const LINE_SPACING = 0.05;
const MAX_LINE_RAW = 4000;
const MAX_LINE_DOMINOES = 160;
const SLOWMO_SCALE = 0.2;

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q1 = new Quaternion();
const _q2 = new Quaternion();
const _m1 = new Matrix4();
const _m2 = new Matrix4();
const _s1 = new Vector3(1, 1, 1);
const _color = new Color();

const VALID_COLOR = new Color(0.25, 0.95, 1.0);
const INVALID_COLOR = new Color(1.0, 0.25, 0.3);
const ERASE_COLOR = new Color(1.0, 0.2, 0.25);

function soundKind(piece) {
  if (!piece) return 'domino';
  switch (piece.type) {
    case 'pin':
      return 'pin';
    case 'marble':
    case 'trigger':
      return 'marble';
    case 'barrel':
    case 'seesaw':
    case 'ramp':
    case 'bumper':
      return 'heavy';
    default:
      return 'domino';
  }
}

export class Game {
  constructor({ sim, scene, views, effects, trails, text, sound, lowCost = false }) {
    this.sim = sim;
    this.scene = scene;
    this.views = views;
    this.effects = effects;
    this.trails = trails;
    this.text = text;
    this.sound = sound;
    this.lowCost = lowCost;
    this.recorder = new Recorder(sim);

    this.tool = 'domino';
    this.slowmo = false;
    this.timeScale = 1;
    this.fxTime = 0;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.lastToppleTime = -10;
    this.levelIndex = -1;
    this.info = 'Pick a tool and build';
    this.placementYaw = 0;
    this.impactBudget = 0;
    this.listeners = [];

    this.surfaceProvider = () => [];
    this.viewerPosition = new Vector3(0, 1.6, 1);

    this.ghostMat = createGhostMaterial();
    this.ghosts = {};
    this.activeGhost = null;
    this.ghostTime = 0;

    this.lineGhost = new InstancedMesh(views.geometries.domino, createGhostMaterial(), MAX_LINE_DOMINOES);
    this.lineGhost.instanceMatrix.setUsage(DynamicDrawUsage);
    this.lineGhost.count = 0;
    this.lineGhost.frustumCulled = false;
    this.lineGhost.renderOrder = 12;
    scene.add(this.lineGhost);
    this.lineRaw = new Float32Array(MAX_LINE_RAW * 6);
    this.lineRawCount = 0;
    this.lineOut = new Float32Array(MAX_LINE_DOMINOES * 9);
    this.lineOutCount = 0;
    this.lineActive = false;

    this.reticle = new Mesh(
      new RingGeometry(0.012, 0.016, 32).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0x5ff6ff, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
    );
    this.reticle.renderOrder = 13;
    this.reticle.visible = false;
    scene.add(this.reticle);

    this.grabs = new Map();
    this.lastHit = { has: false, point: new Vector3(), normal: new Vector3(), valid: false };
    this.rollerSpeeds = new Float32Array(64);

    this._wireSimEvents();
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  _changed() {
    for (const fn of this.listeners) fn(this);
  }

  // ------------------------------------------------------------ sim events
  _wireSimEvents() {
    const { sim } = this;
    sim.onStep = () => this.recorder.capture();

    sim.on('add', (p) => {
      if (p.type === 'marble') {
        _color.setHSL(p.hue, 0.95, 0.6);
        this.trails.attach(p, _color.r, _color.g, _color.b, 0.008);
      } else if (p.type === 'trigger') {
        this.trails.attach(p, 0.2, 0.95, 1.0, 0.018);
      }
    });
    sim.on('remove', (p) => {
      this.trails.detach(p);
      for (const [id, g] of this.grabs) if (g.piece === p) this.grabs.delete(id);
    });

    sim.on('impact', (e) => {
      if (e.speed < 0.06 || this.impactBudget <= 0) return;
      this.impactBudget--;
      const kind = e.b ? soundKind(e.a.type === 'domino' ? e.b : e.a) : soundKind(e.a);
      this._impactFx(e.x, e.y, e.z, e.speed, kind, !e.b);
      this.recorder.event('impact', e.x, e.y, e.z, e.speed, !e.b ? 1 : 0, kind);
    });

    sim.on('topple', (p) => {
      this.views.flash(p);
      const t = sim.simTime;
      this.combo = t - this.lastToppleTime < 0.7 ? this.combo + 1 : 1;
      this.lastToppleTime = t;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.score += 10 * Math.min(this.combo, 25);
      if (this.combo > 0 && this.combo % 5 === 0) {
        const buf = p.interp[0];
        this._comboFx(buf[7], buf[8], buf[9], this.combo);
        this.recorder.event('combo', buf[7], buf[8], buf[9], this.combo);
      }
      this._changed();
    });

    sim.on('explode', (e) => {
      this._explodeFx(e.x, e.y, e.z);
      this.recorder.event('explode', e.x, e.y, e.z);
    });

    sim.on('bump', (e) => {
      this.views.pulse(e.piece);
      this._bumpFx(e.x, e.y, e.z);
      this.recorder.event('bump', e.x, e.y, e.z, 0, 0, e.piece);
    });

    sim.on('runEnd', (e) => {
      this.recorder.end();
      this._runEndFx(e);
      this._changed();
    });
  }

  _impactFx(x, y, z, speed, kind, onStatic) {
    this.sound.click(x, y, z, speed, kind);
    if (onStatic && speed > 0.18) this.effects.dust(x, y, z, kind === 'heavy' ? 6 : 3, 0.025);
    if (speed > 0.55) this.effects.sparks(x, y, z, Math.min(14, Math.round(speed * 6)), 0.6, 0.95, 1, speed * 0.8, 0.005);
  }

  _comboFx(x, y, z, combo) {
    this.text.show(`COMBO x${combo}`, x, y + 0.12, z, { color: '#ffffff', glow: '#ff5cd6', scale: 0.16 + Math.min(combo, 40) * 0.002 });
    this.sound.combo(Math.floor(combo / 5));
    this.effects.sparks(x, y + 0.05, z, 16, 1, 0.4, 0.9, 0.9, 0.006);
  }

  _explodeFx(x, y, z) {
    this.effects.explosion(x, y, z);
    this.sound.boom(x, y, z);
    this.text.show('BOOM!', x, y + 0.16, z, { color: '#ffe08a', glow: '#ff6a1a', scale: 0.2, life: 1.1 });
  }

  _bumpFx(x, y, z) {
    this.sound.boing(x, y, z);
    this.effects.sparks(x, y, z, 10, 1, 0.3, 0.95, 0.8, 0.006);
  }

  _runEndFx(e) {
    const c = this._layoutCenter(_v1);
    if (e.perfect) {
      this.text.show('PERFECT RUN!', c.x, c.y + 0.32, c.z, {
        color: '#fff7c2',
        glow: '#ffcf3d',
        scale: 0.42,
        life: 3.2,
        sub: `${e.toppled}/${e.total} · best combo x${this.bestCombo} · ${this.score} pts`,
      });
      this.effects.confetti(c.x, c.y + 0.1, c.z, this.lowCost ? 160 : 260);
      this.sound.fanfare(true);
    } else {
      this.text.show(`${e.toppled} / ${e.total}`, c.x, c.y + 0.28, c.z, {
        color: '#ffffff',
        glow: '#38e8ff',
        scale: 0.32,
        life: 2.6,
        sub: `toppled · best combo x${this.bestCombo} · ${this.score} pts`,
      });
      this.sound.fanfare(false);
    }
    this.info = e.perfect ? 'Perfect run!' : `${e.toppled}/${e.total} toppled — Replay or Reset`;
  }

  _layoutCenter(out) {
    out.set(0, 0, 0);
    let n = 0;
    for (const p of this.sim.pieces) {
      out.x += p.home.pos.x;
      out.y += p.home.pos.y;
      out.z += p.home.pos.z;
      n++;
    }
    if (n) out.multiplyScalar(1 / n);
    else out.copy(this.viewerPosition).add(_v3.set(0, -0.6, -0.8));
    return out;
  }

  // ---------------------------------------------------------------- state
  get state() {
    const st = this.sim.stats();
    return {
      tool: this.tool,
      slowmo: this.slowmo,
      phase: this.recorder.playing ? 'replay' : this.sim.phase,
      score: this.score,
      toppled: st.toppled,
      total: st.total,
      combo: this.sim.phase === 'run' ? this.combo : 0,
      levelName: this.levelIndex >= 0 ? LEVELS[this.levelIndex % LEVELS.length].name : '',
      replaying: this.recorder.playing,
      info: this.info,
    };
  }

  setTool(id) {
    if (this.lineActive) this.lineCancel();
    this.tool = id;
    this.info = `Tool: ${id === 'line' ? 'Domino Line (drag)' : id[0].toUpperCase() + id.slice(1)}`;
    this.hideGhost();
    this._changed();
  }

  action(id) {
    switch (id) {
      case 'start':
        this.start();
        break;
      case 'reset':
        this.reset();
        break;
      case 'slowmo':
        this.toggleSlowmo();
        break;
      case 'replay':
        this.toggleReplay();
        break;
      case 'level':
        this.loadLevel(this.levelIndex + 1);
        break;
      case 'clear':
        this.clear();
        break;
      default:
        if (PIECE_INFO[id] || id === 'line' || id === 'erase') this.setTool(id);
    }
    this._changed();
  }

  activate(item) {
    if (item.kind === 'tool') this.setTool(item.id);
    else this.action(item.id);
  }

  start() {
    if (this.recorder.playing) this.recorder.stopPlayback();
    if (this.sim.phase === 'run') return;
    for (const [id] of this.grabs) this.endGrab(id);
    if (this.sim.phase === 'done') this.views.refreshColors();
    if (!this.sim.pieces.length) {
      this.info = 'Place some pieces first';
      return;
    }
    const started = this.sim.start();
    if (!started) return;
    this.views.refreshColors();
    this.trails.reset();
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.lastToppleTime = -10;
    this.recorder.begin();
    const trig = this.sim.pieces.find((p) => p.type === 'trigger');
    const c = trig ? trig.home.pos : this._layoutCenter(_v1);
    this.sound.whoosh(c.x, c.y, c.z);
    this.effects.shockwave(c.x, c.y, c.z, 0.35, 0.5, 0.2, 0.95, 1);
    this.info = trig ? 'Chain reaction running…' : 'No trigger ball — push something!';
  }

  reset() {
    if (this.recorder.playing) this.recorder.stopPlayback();
    for (const [id] of this.grabs) this.endGrab(id);
    this.sim.reset();
    this.views.refreshColors();
    this.trails.reset();
    this.sound.silenceRollers();
    this.score = 0;
    this.combo = 0;
    this.info = 'Layout restored';
  }

  clear() {
    if (this.recorder.playing) this.recorder.stopPlayback();
    for (const [id] of this.grabs) this.endGrab(id);
    this.sim.clearPieces();
    this.recorder.clear();
    this.trails.reset();
    this.sound.silenceRollers();
    this.score = 0;
    this.combo = 0;
    this.levelIndex = -1;
    this.info = 'Cleared — build something new';
  }

  toggleSlowmo() {
    this.slowmo = !this.slowmo;
    this.sound.slowmo(this.slowmo);
    this.info = this.slowmo ? 'Bullet time on' : 'Bullet time off';
  }

  toggleReplay() {
    if (this.recorder.playing) {
      this.recorder.stopPlayback();
      this.info = 'Replay stopped';
      return;
    }
    if (this.sim.phase === 'run') {
      this.info = 'Wait for the run to finish';
      return;
    }
    if (!this.recorder.hasRecording) {
      this.info = 'No run recorded yet';
      return;
    }
    for (const [id] of this.grabs) this.endGrab(id);
    this.views.refreshColors();
    this.trails.reset();
    this.recorder.startPlayback();
    this.info = 'Replaying last run';
  }

  // ---------------------------------------------------------------- levels
  loadLevel(index) {
    const n = LEVELS.length;
    const idx = ((index % n) + n) % n;
    const frame = this._levelFrame(idx);
    this.clear();
    const { level } = placeLevel(this.sim, idx, frame);
    this.levelIndex = idx;
    this.info = `Level ${idx + 1}: ${level.name}`;
    const o = frame.origin;
    this.text.show(`LEVEL ${idx + 1}`, o.x, o.y + 0.3, o.z, { sub: level.name, glow: '#38e8ff', scale: 0.3, life: 2.4 });
    this.effects.shockwave(o.x, o.y, o.z, 1.6, 0.9, 0.2, 0.95, 1);
    this.sound.fanfare(false);
    this._changed();
  }

  _levelFrame(idx) {
    const bounds = levelBounds(idx);
    const surfaces = this.surfaceProvider().filter((s) => s.normal.y > 0.88);
    const viewer = this.viewerPosition;
    const needU = bounds.w + 0.06;
    const needV = bounds.d + 0.06;
    const fits = (s) => {
      const a = Math.max(s.halfU, s.halfV) * 2;
      const b = Math.min(s.halfU, s.halfV) * 2;
      return a >= Math.max(needU, needV) * 0.92 && b >= Math.min(needU, needV) * 0.92;
    };
    let best = null;
    for (const s of surfaces) {
      if (s.kind === 'floor') continue;
      if (!fits(s)) continue;
      if (!best || s.area > best.area) best = s;
    }
    const frame = { origin: new Vector3(), right: new Vector3(), forward: new Vector3(), up: UP.clone() };
    if (best) {
      frame.origin.copy(best.center);
      frame.up.copy(best.normal);
      // Align the long side of the layout with the long side of the table,
      // forward pointing away from the viewer.
      const axisU = _v1.set(1, 0, 0).applyQuaternion(best.quaternion);
      const axisV = _v2.set(0, 0, 1).applyQuaternion(best.quaternion);
      const layoutWide = needU >= needV;
      const tableWideU = best.halfU >= best.halfV;
      const fwdAxis = layoutWide === tableWideU ? axisV : axisU;
      _v3.subVectors(best.center, viewer);
      _v3.y = 0;
      if (fwdAxis.dot(_v3) < 0) fwdAxis.negate();
      frame.forward.copy(fwdAxis).addScaledVector(frame.up, -fwdAxis.dot(frame.up)).normalize();
    } else {
      const floor = surfaces.find((s) => s.kind === 'floor');
      const floorY = floor ? floor.center.y : 0;
      _v3.set(0, 0, -1);
      if (this.viewerForward) _v3.copy(this.viewerForward);
      _v3.y = 0;
      if (_v3.lengthSq() < 1e-4) _v3.set(0, 0, -1);
      _v3.normalize();
      frame.forward.copy(_v3);
      frame.origin.copy(viewer).addScaledVector(_v3, 0.55 + bounds.d / 2);
      frame.origin.y = floorY;
    }
    frame.right.crossVectors(frame.forward, frame.up).normalize();
    return frame;
  }

  // ------------------------------------------------------------- placement
  /** Converts a ray into a placement hit using the physics world. */
  rayHit(origin, dir, maxDist = 6, out = {}) {
    const hit = this.sim.castRay(origin, dir, maxDist, 'surface');
    if (!hit) return null;
    out.point = out.point || new Vector3();
    out.normal = out.normal || new Vector3();
    out.point.copy(origin).addScaledVector(dir, hit.distance);
    out.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    if (out.normal.dot(dir) > 0) out.normal.negate();
    out.distance = hit.distance;
    out.piece = hit.piece;
    out.valid = out.normal.y > 0.65;
    return out;
  }

  pickPiece(origin, dir, maxDist = 6) {
    const hit = this.sim.castRay(origin, dir, maxDist, 'piece');
    if (!hit || !hit.piece) return null;
    return { piece: hit.piece, distance: hit.distance };
  }

  nearestPiece(point, radius) {
    let best = null;
    let bestD = radius;
    for (const p of this.sim.pieces) {
      if (p.held) continue;
      for (let i = 0; i < p.bodies.length; i++) {
        const buf = p.interp[i];
        _v1.set(buf[7], buf[8], buf[9]);
        let d = _v1.distanceTo(point);
        const h = this._pieceHalfHeight(p.type);
        _v2.set(buf[7], buf[8] + h, buf[9]);
        d = Math.min(d, _v2.distanceTo(point));
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    return best;
  }

  _pieceHalfHeight(type) {
    switch (type) {
      case 'domino':
        return DIM.domino.h / 2;
      case 'pin':
        return DIM.pin.h / 2;
      case 'barrel':
        return DIM.barrel.h / 2;
      case 'ramp':
        return DIM.ramp.rise / 2;
      default:
        return 0;
    }
  }

  _placementDirection(point, normal, out) {
    out.subVectors(point, this.viewerPosition);
    out.addScaledVector(normal, -out.dot(normal));
    if (out.lengthSq() < 1e-6) out.set(0, 0, -1);
    out.normalize();
    if (this.placementYaw !== 0) out.applyAxisAngle(normal, this.placementYaw);
    return out;
  }

  _ghostFor(type) {
    if (!this.ghosts[type]) {
      const g = this.views.ghostGeometries[type];
      if (!g) return null;
      const m = new Mesh(g, this.ghostMat);
      m.renderOrder = 12;
      m.visible = false;
      this.scene.add(m);
      this.ghosts[type] = m;
    }
    return this.ghosts[type];
  }

  hideGhost() {
    if (this.activeGhost) this.activeGhost.visible = false;
    this.activeGhost = null;
    this.reticle.visible = false;
  }

  /** Updates the placement preview for the current tool. hit may be null. */
  updateGhost(hit, aimOrigin = null, aimDir = null) {
    if (this.recorder.playing) {
      this.hideGhost();
      return;
    }
    if (this.tool === 'erase') {
      this.reticle.visible = false;
      let target = null;
      if (aimOrigin && aimDir) {
        const pick = this.pickPiece(aimOrigin, aimDir);
        if (pick) target = pick.piece;
      }
      this._showEraseGhost(target);
      return;
    }
    if (!hit) {
      this.lastHit.has = false;
      this.hideGhost();
      return;
    }
    this.lastHit.has = true;
    this.lastHit.point.copy(hit.point);
    this.lastHit.normal.copy(hit.normal);
    this.lastHit.valid = hit.valid;
    this.reticle.visible = true;
    this.reticle.position.copy(hit.point).addScaledVector(hit.normal, 0.002);
    this.reticle.quaternion.setFromUnitVectors(UP, hit.normal);
    this.reticle.material.color.copy(hit.valid ? VALID_COLOR : INVALID_COLOR);

    if (this.tool === 'line') {
      if (this.activeGhost) this.activeGhost.visible = false;
      this.activeGhost = null;
      if (!this.lineActive) {
        const g = this._ghostFor('domino');
        this._poseGhost(g, 'domino', hit);
        this.activeGhost = g;
      }
      return;
    }
    const g = this._ghostFor(this.tool);
    if (!g) return;
    if (this.activeGhost && this.activeGhost !== g) this.activeGhost.visible = false;
    this._poseGhost(g, this.tool, hit);
    this.activeGhost = g;
  }

  _poseGhost(g, type, hit) {
    g.visible = true;
    g.material = this.ghostMat;
    g.scale.setScalar(1);
    this.ghostMat.uniforms.uColor.value.copy(hit.valid ? VALID_COLOR : INVALID_COLOR);
    this._placementDirection(hit.point, hit.normal, _v1);
    basisQuaternion(_v1, hit.normal, g.quaternion);
    g.position.copy(hit.point).addScaledVector(hit.normal, spawnLift(type));
  }

  _showEraseGhost(piece) {
    if (!piece) {
      this.hideGhost();
      return;
    }
    const type = piece.type;
    const g = this._ghostFor(type);
    if (!g) return;
    if (this.activeGhost && this.activeGhost !== g) this.activeGhost.visible = false;
    if (!this.eraseMat) {
      this.eraseMat = createGhostMaterial();
      this.eraseMat.uniforms.uColor.value.copy(ERASE_COLOR);
    }
    g.material = this.eraseMat;
    const buf = piece.interp[0];
    g.position.set(buf[7], buf[8], buf[9]);
    g.quaternion.set(buf[10], buf[11], buf[12], buf[13]);
    g.scale.setScalar(1.06);
    g.visible = true;
    this.activeGhost = g;
    this.eraseTarget = piece;
  }

  /** Places the current tool at a hit. Returns the piece or null. */
  placeAt(hit) {
    if (this.recorder.playing || !hit || !hit.valid) {
      if (hit && !hit.valid) this.sound.tone(180, 0.12, 0.08, 'square');
      return null;
    }
    const type = this.tool;
    if (!PIECE_INFO[type]) return null;
    this._placementDirection(hit.point, hit.normal, _v1);
    basisQuaternion(_v1, hit.normal, _q1);
    _v2.copy(hit.point).addScaledVector(hit.normal, spawnLift(type));
    const piece = this.sim.addPiece(type, _v2, _q1, { hue: this._nextHue() });
    this.sound.place(_v2.x, _v2.y, _v2.z);
    this.effects.dust(hit.point.x, hit.point.y, hit.point.z, 4, 0.02, 0.9);
    this.effects.shockwave(hit.point.x, hit.point.y, hit.point.z, 0.12, 0.35, 0.2, 0.95, 1);
    if (this.sim.phase === 'done') this.info = 'Added — press Start to rerun';
    this._changed();
    return piece;
  }

  _nextHue() {
    this.hueCursor = ((this.hueCursor ?? 0.5) + 0.027) % 1;
    return this.hueCursor;
  }

  eraseAt(origin, dir) {
    if (this.recorder.playing) return false;
    const pick = this.pickPiece(origin, dir);
    if (!pick) return false;
    this.erase(pick.piece);
    return true;
  }

  erase(piece) {
    const buf = piece.interp[0];
    this.effects.dust(buf[7], buf[8], buf[9], 8, 0.03, 0.9);
    this.effects.sparks(buf[7], buf[8] + 0.03, buf[9], 12, 1, 0.3, 0.4, 0.6, 0.005);
    this.sound.pop(buf[7], buf[8], buf[9]);
    this.sim.removePiece(piece);
    this.hideGhost();
    this._changed();
  }

  // ------------------------------------------------------------ domino line
  lineStart(hit) {
    if (this.recorder.playing || !hit || !hit.valid) return false;
    this.lineActive = true;
    this.lineRawCount = 0;
    this._lineAddRaw(hit);
    this.hideGhost();
    return true;
  }

  lineMove(hit) {
    if (!this.lineActive || !hit || !hit.valid) return;
    const n = this.lineRawCount - 1;
    const r = this.lineRaw;
    _v1.set(r[n * 6], r[n * 6 + 1], r[n * 6 + 2]);
    if (_v1.distanceTo(hit.point) < 0.008) return;
    if (_v1.distanceTo(hit.point) > 0.4) return;
    this._lineAddRaw(hit);
    this._lineResample();
    this._lineUpdateGhost();
  }

  _lineAddRaw(hit) {
    if (this.lineRawCount >= MAX_LINE_RAW) return;
    const o = this.lineRawCount * 6;
    const r = this.lineRaw;
    r[o] = hit.point.x;
    r[o + 1] = hit.point.y;
    r[o + 2] = hit.point.z;
    r[o + 3] = hit.normal.x;
    r[o + 4] = hit.normal.y;
    r[o + 5] = hit.normal.z;
    this.lineRawCount++;
  }

  _lineResample() {
    const r = this.lineRaw;
    const n = this.lineRawCount;
    const out = this.lineOut;
    let count = 0;
    if (n < 2) {
      this.lineOutCount = 0;
      return;
    }
    let carried = 0;
    const emit = (x, y, z, nx, ny, nz) => {
      if (count >= MAX_LINE_DOMINOES) return;
      const o = count * 9;
      out[o] = x;
      out[o + 1] = y;
      out[o + 2] = z;
      out[o + 3] = nx;
      out[o + 4] = ny;
      out[o + 5] = nz;
      count++;
    };
    emit(r[0], r[1], r[2], r[3], r[4], r[5]);
    for (let i = 1; i < n; i++) {
      const ax = r[(i - 1) * 6];
      const ay = r[(i - 1) * 6 + 1];
      const az = r[(i - 1) * 6 + 2];
      const bx = r[i * 6];
      const by = r[i * 6 + 1];
      const bz = r[i * 6 + 2];
      const seg = Math.hypot(bx - ax, by - ay, bz - az);
      let pos = LINE_SPACING - carried;
      while (pos <= seg) {
        const t = pos / seg;
        emit(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, r[i * 6 + 3], r[i * 6 + 4], r[i * 6 + 5]);
        pos += LINE_SPACING;
      }
      carried = seg - (pos - LINE_SPACING);
    }
    // Tangents from neighbours
    for (let i = 0; i < count; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(count - 1, i + 1);
      let tx = out[b * 9] - out[a * 9];
      let ty = out[b * 9 + 1] - out[a * 9 + 1];
      let tz = out[b * 9 + 2] - out[a * 9 + 2];
      if (count === 1) {
        tx = r[(n - 1) * 6] - r[0];
        ty = r[(n - 1) * 6 + 1] - r[1];
        tz = r[(n - 1) * 6 + 2] - r[2];
      }
      out[i * 9 + 6] = tx;
      out[i * 9 + 7] = ty;
      out[i * 9 + 8] = tz;
    }
    this.lineOutCount = count;
  }

  _linePose(i, pos, quat) {
    const o = i * 9;
    const out = this.lineOut;
    _v3.set(out[o + 3], out[o + 4], out[o + 5]).normalize();
    _v1.set(out[o + 6], out[o + 7], out[o + 8]);
    if (_v1.lengthSq() < 1e-8) _v1.set(0, 0, 1);
    basisQuaternion(_v1.normalize(), _v3, quat);
    pos.set(out[o], out[o + 1], out[o + 2]).addScaledVector(_v3, spawnLift('domino'));
  }

  _lineUpdateGhost() {
    const g = this.lineGhost;
    for (let i = 0; i < this.lineOutCount; i++) {
      this._linePose(i, _v2, _q1);
      _m1.compose(_v2, _q1, _s1);
      g.setMatrixAt(i, _m1);
    }
    g.count = this.lineOutCount;
    g.instanceMatrix.needsUpdate = true;
  }

  lineEnd() {
    if (!this.lineActive) return 0;
    this.lineActive = false;
    this._lineResample();
    const count = this.lineOutCount;
    const baseHue = this._nextHue();
    for (let i = 0; i < count; i++) {
      this._linePose(i, _v2, _q1);
      this.sim.addPiece('domino', _v2, _q1, { hue: (baseHue + (i / Math.max(1, count)) * 0.35) % 1 });
    }
    this.lineGhost.count = 0;
    this.lineRawCount = 0;
    this.lineOutCount = 0;
    if (count) {
      this.sound.place(_v2.x, _v2.y, _v2.z);
      this.sound.tone(660, 0.12, 0.08, 'triangle', 0.05);
      this.info = `Laid ${count} dominoes`;
    }
    this._changed();
    return count;
  }

  lineCancel() {
    this.lineActive = false;
    this.lineGhost.count = 0;
    this.lineRawCount = 0;
  }

  // ---------------------------------------------------------------- grabbing
  beginGrab(id, piece, handMatrix) {
    if (!piece || piece.held || this.recorder.playing) return false;
    this.sim.holdPiece(piece);
    const buf = piece.interp[0];
    _v1.set(buf[7], buf[8], buf[9]);
    _q1.set(buf[10], buf[11], buf[12], buf[13]);
    _m1.compose(_v1, _q1, _s1);
    const offset = new Matrix4().copy(handMatrix).invert().multiply(_m1);
    this.grabs.set(id, {
      piece,
      offset,
      hist: new Float32Array(8 * 4),
      histCount: 0,
      histHead: 0,
      lastQuat: _q1.clone(),
      angVel: new Vector3(),
    });
    this.sound.tone(740, 0.06, 0.08, 'sine');
    this.effects.sparks(_v1.x, _v1.y, _v1.z, 6, 0.4, 0.95, 1, 0.4, 0.004);
    return true;
  }

  updateGrab(id, handMatrix, now) {
    const g = this.grabs.get(id);
    if (!g) return;
    _m2.multiplyMatrices(handMatrix, g.offset);
    _m2.decompose(_v1, _q1, _v3);
    this.sim.setHeldTarget(g.piece, _v1, _q1);
    const h = g.hist;
    const o = g.histHead * 4;
    h[o] = _v1.x;
    h[o + 1] = _v1.y;
    h[o + 2] = _v1.z;
    h[o + 3] = now;
    g.histHead = (g.histHead + 1) % 8;
    g.histCount = Math.min(8, g.histCount + 1);
    // Angular velocity estimate from frame-to-frame rotation.
    _q2.copy(g.lastQuat).invert().premultiply(_q1);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(_q2.w)));
    const dt = g.lastTime ? Math.max(1e-3, now - g.lastTime) : 1 / 72;
    if (angle > 1e-4) {
      const s = Math.sqrt(1 - _q2.w * _q2.w) || 1;
      const sign = _q2.w < 0 ? -1 : 1;
      g.angVel.set((_q2.x / s) * sign, (_q2.y / s) * sign, (_q2.z / s) * sign).multiplyScalar(angle / dt);
    } else {
      g.angVel.multiplyScalar(0.5);
    }
    g.lastQuat.copy(_q1);
    g.lastTime = now;
  }

  endGrab(id) {
    const g = this.grabs.get(id);
    if (!g) return;
    this.grabs.delete(id);
    const vel = new Vector3();
    if (g.histCount >= 3) {
      const newest = (g.histHead + 7) % 8;
      const oldest = (g.histHead + 8 - g.histCount) % 8;
      const h = g.hist;
      const dt = h[newest * 4 + 3] - h[oldest * 4 + 3];
      if (dt > 1e-3) {
        vel.set(h[newest * 4] - h[oldest * 4], h[newest * 4 + 1] - h[oldest * 4 + 1], h[newest * 4 + 2] - h[oldest * 4 + 2]).multiplyScalar(1 / dt);
      }
    }
    if (vel.length() > 7) vel.setLength(7);
    if (g.angVel.length() > 25) g.angVel.setLength(25);
    if (!g.piece.removed) this.sim.releasePiece(g.piece, vel, g.angVel);
    this.sound.tone(520, 0.06, 0.06, 'sine');
  }

  isGrabbing(id) {
    return this.grabs.has(id);
  }

  // ---------------------------------------------------------------- update
  update(dt, camera) {
    const target = this.slowmo ? SLOWMO_SCALE : 1;
    this.timeScale += (target - this.timeScale) * Math.min(1, dt * 6);
    if (Math.abs(this.timeScale - target) < 0.002) this.timeScale = target;
    this.sound.pitch = 0.55 + 0.45 * ((this.timeScale - SLOWMO_SCALE) / (1 - SLOWMO_SCALE));
    this.impactBudget = this.lowCost ? 10 : 18;

    let alpha;
    if (this.recorder.playing) {
      alpha = this.recorder.update(dt, this.timeScale, (e) => this._replayEvent(e));
      if (!this.recorder.playing) this.info = 'Replay finished';
    } else {
      this.sim.advance(dt, this.timeScale);
      alpha = this.sim.alpha;
      for (const p of this.sim.pieces) {
        if (p.type === 'barrel') p.hidden = !p.bodies[0].isEnabled();
      }
    }

    this.fxTime += dt * this.timeScale;
    this.views.update(alpha, dt);
    this.effects.update(this.fxTime, dt * this.timeScale);
    this.trails.update(camera.position, dt);
    this.text.update(dt);
    this.ghostTime += dt;
    this.ghostMat.uniforms.uTime.value = this.ghostTime;
    this.lineGhost.material.uniforms.uTime.value = this.ghostTime;
    if (this.eraseMat) this.eraseMat.uniforms.uTime.value = this.ghostTime;
    this._updateRollers();
  }

  _replayEvent(e) {
    switch (e.type) {
      case 'impact':
        this._impactFx(e.x, e.y, e.z, e.a, e.ref, e.b === 1);
        break;
      case 'explode':
        this._explodeFx(e.x, e.y, e.z);
        break;
      case 'bump':
        if (e.ref) this.views.pulse(e.ref);
        this._bumpFx(e.x, e.y, e.z);
        break;
      case 'combo':
        this._comboFx(e.x, e.y, e.z, e.a);
        break;
      default:
    }
  }

  _updateRollers() {
    const sound = this.sound;
    const n = sound.rollerCount;
    if (!n) return;
    const pieces = this.sim.pieces;
    const used = this._rollerUsed || (this._rollerUsed = new Array(n).fill(null));
    let slot = 0;
    const invDt = 1 / FIXED_DT;
    for (let i = 0; i < pieces.length && slot < n; i++) {
      const p = pieces[i];
      if (!p.info.ball || p.hidden) continue;
      const b = p.interp[0];
      const vx = (b[7] - b[0]) * invDt;
      const vy = (b[8] - b[1]) * invDt;
      const vz = (b[9] - b[2]) * invDt;
      const speed = Math.hypot(vx, vz);
      if (speed < 0.03) continue;
      const rolling = Math.abs(vy) < 0.35 && !p.held;
      sound.updateRoller(slot, b[7], b[8], b[9], speed * this.timeScale, rolling, p.type === 'trigger');
      used[slot] = p;
      slot++;
    }
    for (; slot < n; slot++) {
      if (used[slot]) {
        sound.updateRoller(slot, 0, 0, 0, 0, false, false);
        used[slot] = null;
      }
    }
  }
}
