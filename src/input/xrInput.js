// XR input: controllers (ray + buttons + thumbsticks) and hand tracking
// (pinch, grab, twist, poke). Placement uses WebXR hit-test when available
// and falls back to physics ray casts against the reconstructed room.

import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { TOOLS } from '../ui/items.js';

const PINCH_ON = 0.018;
const PINCH_OFF = 0.032;
const GRAB_RADIUS = 0.075;
const RAY_GRAB_DIST = 4;

const _o = new Vector3();
const _d = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _n = new Vector3();
const _q1 = new Quaternion();
const _q2 = new Quaternion();
const _m1 = new Matrix4();
const _one = new Vector3(1, 1, 1);
const UP = new Vector3(0, 1, 0);

const LASER_VERT = /* glsl */ `
varying float vT;
void main() {
  vT = -position.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const LASER_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vT;
void main() {
  float a = (1.0 - vT) * 0.85 + 0.1;
  gl_FragColor = vec4(uColor * a, 0.0);
}`;

function makeLaser() {
  const geo = new CylinderGeometry(0.0012, 0.0006, 1, 6, 1, true);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -0.5);
  const mat = new ShaderMaterial({
    uniforms: { uColor: { value: new Vector3(0.3, 0.95, 1.0) } },
    vertexShader: LASER_VERT,
    fragmentShader: LASER_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const m = new Mesh(geo, mat);
  m.renderOrder = 14;
  m.frustumCulled = false;
  return m;
}

function makeControllerModel(color) {
  const g = new Group();
  const body = new Mesh(
    new CylinderGeometry(0.016, 0.02, 0.1, 16),
    new MeshStandardMaterial({ color: 0x1a1d27, roughness: 0.35, metalness: 0.7 }),
  );
  body.rotation.x = Math.PI / 2 - 0.5;
  body.position.set(0, -0.01, 0.045);
  g.add(body);
  const ring = new Mesh(
    new TorusGeometry(0.032, 0.0035, 8, 32),
    new MeshBasicMaterial({ color, toneMapped: false }),
  );
  ring.position.set(0, 0.012, -0.01);
  ring.rotation.x = 0.4;
  g.add(ring);
  return g;
}

function makeTip(color, r = 0.0055) {
  const m = new Mesh(
    new SphereGeometry(r, 12, 8),
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  m.renderOrder = 16;
  m.visible = false;
  return m;
}

export class XRInput {
  constructor({ renderer, scene, game, menu, sound }) {
    this.renderer = renderer;
    this.scene = scene;
    this.game = game;
    this.menu = menu;
    this.sound = sound;
    this.session = null;
    this.refSpace = null;
    this.slots = [];
    this.hitPose = new Vector3();
    this.hitNormal = new Vector3();
    this.hitScratch = { point: new Vector3(), normal: new Vector3() };
    this.xrHit = { point: new Vector3(), normal: new Vector3(), valid: false, distance: 0, piece: null };
    this.headPos = new Vector3();
    this.toolRepeat = 0;

    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      scene.add(ray, grip, hand);
      const laser = makeLaser();
      laser.visible = false;
      ray.add(laser);
      const slot = {
        index: i,
        ray,
        grip,
        hand,
        laser,
        model: null,
        source: null,
        handedness: 'none',
        isHand: false,
        hitTestSource: null,
        hitTestPending: false,
        buttons: [false, false, false, false, false, false],
        pinching: false,
        pinchMode: null,
        grabbing: false,
        triggerMode: null,
        twistRef: new Quaternion(),
        twistBaseYaw: 0,
        pokeArmed: true,
        thumbTip: makeTip(0x7ff6ff),
        indexTip: makeTip(0xff7ff0),
        handMatrix: new Matrix4(),
        stickLatch: false,
      };
      scene.add(slot.thumbTip, slot.indexTip);
      ray.addEventListener('connected', (e) => this._connected(slot, e.data));
      ray.addEventListener('disconnected', () => this._disconnected(slot));
      this.slots.push(slot);
    }
  }

  start(session, refSpace) {
    this.session = session;
    this.refSpace = refSpace;
    this.hitTestEnabled = !session.enabledFeatures || session.enabledFeatures.includes('hit-test');
  }

  end() {
    for (const s of this.slots) {
      this._cancelHitTest(s);
      if (s.grabbing) this.game.endGrab(this._grabId(s));
      s.grabbing = false;
      s.pinching = false;
      s.pinchMode = null;
      s.triggerMode = null;
    }
    this.session = null;
    this.menu.group.visible = false;
  }

  _grabId(slot) {
    return 'xr' + slot.index;
  }

  _connected(slot, source) {
    slot.source = source;
    slot.handedness = source.handedness || 'none';
    slot.isHand = !!source.hand;
    if (!slot.isHand && !slot.model) {
      slot.model = makeControllerModel(slot.handedness === 'left' ? 0xff4fe0 : 0x46f2ff);
      slot.grip.add(slot.model);
    }
    if (slot.model) slot.model.visible = !slot.isHand;
    slot.laser.visible = slot.handedness !== 'left' || !slot.isHand;
    slot.buttons.fill(false);
    this._requestHitTest(slot);
  }

  _disconnected(slot) {
    if (slot.grabbing) this.game.endGrab(this._grabId(slot));
    if (slot.triggerMode === 'line') this.game.lineCancel();
    slot.grabbing = false;
    slot.source = null;
    slot.isHand = false;
    slot.pinching = false;
    slot.pinchMode = null;
    slot.triggerMode = null;
    slot.laser.visible = false;
    slot.thumbTip.visible = false;
    slot.indexTip.visible = false;
    this._cancelHitTest(slot);
  }

  _requestHitTest(slot) {
    const session = this.session;
    if (!session || !this.hitTestEnabled || !slot.source || slot.hitTestPending || slot.hitTestSource) return;
    if (typeof session.requestHitTestSource !== 'function') return;
    slot.hitTestPending = true;
    const source = slot.source;
    session
      .requestHitTestSource({ space: source.targetRaySpace })
      .then((hts) => {
        slot.hitTestPending = false;
        if (slot.source !== source || this.session !== session) {
          hts.cancel();
          return;
        }
        slot.hitTestSource = hts;
      })
      .catch(() => {
        slot.hitTestPending = false;
        this.hitTestEnabled = false;
      });
  }

  _cancelHitTest(slot) {
    if (slot.hitTestSource) {
      try {
        slot.hitTestSource.cancel();
      } catch {
        /* already cancelled */
      }
    }
    slot.hitTestSource = null;
  }

  _haptic(slot, intensity = 0.4, ms = 30) {
    const gp = slot.source && slot.source.gamepad;
    const act = gp && gp.hapticActuators && gp.hapticActuators[0];
    if (act && act.pulse) {
      try {
        act.pulse(intensity, ms);
      } catch {
        /* ignore */
      }
    }
  }

  // --------------------------------------------------------------- per frame
  update(frame, refSpace, dt, time, camera) {
    this.headPos.copy(camera.position);
    const right = this.slots.find((s) => s.source && s.handedness === 'right') ||
      this.slots.find((s) => s.source && s.handedness !== 'left');
    const left = this.slots.find((s) => s.source && s.handedness === 'left');

    this._updateMenuPose(left, camera);

    for (const s of this.slots) {
      if (!s.source) continue;
      if (s.isHand) this._updateHandVisuals(s);
      else {
        s.thumbTip.visible = false;
        s.indexTip.visible = false;
      }
    }

    // Menu interaction by the right pointer (ray or poke).
    let menuHover = -1;
    if (this.menu.group.visible && right) {
      menuHover = this._menuHover(right);
      this._menuPoke(right);
    }
    this.menu.hover = menuHover;

    // Primary pointer -> placement preview
    if (right && !right.grabbing) {
      const hit = menuHover >= 0 ? null : this._pointerHit(frame, refSpace, right);
      this._updateLaser(right, hit, menuHover >= 0);
      if (menuHover < 0) {
        _o.setFromMatrixPosition(right.ray.matrixWorld);
        _d.set(0, 0, -1).transformDirection(right.ray.matrixWorld);
        this.game.updateGhost(hit, _o, _d);
        if (this.game.lineActive) this.game.lineMove(hit);
      } else {
        this.game.hideGhost();
      }
      this._primaryButtons(right, hit, menuHover, dt);
    } else if (right && right.grabbing) {
      this.game.hideGhost();
      right.laser.visible = false;
    } else {
      this.game.hideGhost();
    }

    for (const s of this.slots) {
      if (!s.source) continue;
      if (s !== right && !s.isHand) {
        s.laser.visible = !s.grabbing;
        s.laser.scale.set(1, 1, 0.35);
      }
      this._grabInput(s, time);
      if (!s.isHand) this._faceButtons(s, s === right, dt);
    }
  }

  _pointerHit(frame, refSpace, slot) {
    _o.setFromMatrixPosition(slot.ray.matrixWorld);
    _d.set(0, 0, -1).transformDirection(slot.ray.matrixWorld);
    const phys = this.game.rayHit(_o, _d, 6, this.hitScratch);
    let xr = null;
    if (slot.hitTestSource && frame) {
      const results = frame.getHitTestResults(slot.hitTestSource);
      if (results.length) {
        const pose = results[0].getPose(refSpace);
        if (pose) {
          const p = pose.transform.position;
          const q = pose.transform.orientation;
          xr = this.xrHit;
          xr.point.set(p.x, p.y, p.z);
          _q1.set(q.x, q.y, q.z, q.w);
          xr.normal.copy(UP).applyQuaternion(_q1);
          xr.distance = xr.point.distanceTo(_o);
          xr.valid = xr.normal.y > 0.65;
          xr.piece = null;
        }
      }
    }
    if (xr && phys) return phys.distance < xr.distance - 0.03 ? phys : xr;
    return xr || phys;
  }

  _updateLaser(slot, hit, onMenu) {
    slot.laser.visible = true;
    const len = onMenu ? this._menuDist || 0.3 : hit ? hit.distance : 1.2;
    slot.laser.scale.set(1, 1, Math.max(0.02, len));
    const c = slot.laser.material.uniforms.uColor.value;
    if (onMenu) c.set(1, 1, 1);
    else if (this.game.tool === 'erase') c.set(1, 0.3, 0.35);
    else if (hit && !hit.valid) c.set(1, 0.4, 0.3);
    else c.set(0.3, 0.95, 1.0);
  }

  // ------------------------------------------------------------------ menu
  _updateMenuPose(left, camera) {
    const g = this.menu.group;
    if (!left) {
      g.visible = false;
      return;
    }
    if (left.isHand) {
      const j = left.hand.joints;
      const wrist = j && j['wrist'];
      const idx = j && j['index-finger-metacarpal'];
      const pinky = j && j['pinky-finger-metacarpal'];
      const mid = j && j['middle-finger-metacarpal'];
      if (!wrist || !idx || !pinky || !mid || !wrist.visible) {
        g.visible = false;
        return;
      }
      _v1.subVectors(idx.position, wrist.position);
      _v2.subVectors(pinky.position, wrist.position);
      _n.crossVectors(_v1, _v2).normalize();
      _v3.addVectors(wrist.position, mid.position).multiplyScalar(0.5);
      _v1.subVectors(camera.position, _v3).normalize();
      const facing = _n.dot(_v1);
      const show = g.visible ? facing > 0.35 : facing > 0.55;
      if (!show) {
        g.visible = false;
        return;
      }
      g.position.copy(_v3).addScaledVector(_n, 0.06).addScaledVector(UP, 0.07);
    } else {
      if (!left.grip.visible) {
        g.visible = false;
        return;
      }
      _v3.setFromMatrixPosition(left.grip.matrixWorld);
      _v1.set(0, 0, -1).transformDirection(left.grip.matrixWorld);
      g.position.copy(_v3).addScaledVector(UP, 0.11).addScaledVector(_v1, 0.03);
    }
    g.visible = true;
    g.lookAt(camera.position);
  }

  _menuHover(slot) {
    _o.setFromMatrixPosition(slot.ray.matrixWorld);
    _d.set(0, 0, -1).transformDirection(slot.ray.matrixWorld);
    const mesh = this.menu.mesh;
    _n.set(0, 0, 1).transformDirection(mesh.matrixWorld);
    _v1.setFromMatrixPosition(mesh.matrixWorld);
    const denom = _d.dot(_n);
    if (Math.abs(denom) < 1e-4) return -1;
    const t = _v1.sub(_o).dot(_n) / denom;
    if (t <= 0 || t > 1.5) return -1;
    _v2.copy(_o).addScaledVector(_d, t);
    this._menuDist = t;
    return this.menu.indexAtWorldPoint(_v2);
  }

  _menuPoke(slot) {
    if (!slot.isHand) return;
    const tip = slot.hand.joints && slot.hand.joints['index-finger-tip'];
    if (!tip || !tip.visible) return;
    const dist = this.menu.planeDistance(tip.position);
    if (slot.pokeArmed && dist < 0.008 && dist > -0.03) {
      const idx = this.menu.indexAtWorldPoint(tip.position);
      if (idx >= 0) {
        slot.pokeArmed = false;
        this._activateMenu(idx, slot);
      }
    } else if (!slot.pokeArmed && (dist > 0.025 || dist < -0.05)) {
      slot.pokeArmed = true;
    }
  }

  _activateMenu(idx, slot) {
    const item = this.menu.press(idx);
    this.sound.uiClick();
    this._haptic(slot, 0.3, 20);
    this.game.activate(item);
  }

  // ------------------------------------------------------------ hands
  _updateHandVisuals(slot) {
    const j = slot.hand.joints;
    const thumb = j && j['thumb-tip'];
    const index = j && j['index-finger-tip'];
    if (!thumb || !index || !thumb.visible || !index.visible) {
      slot.thumbTip.visible = false;
      slot.indexTip.visible = false;
      return;
    }
    slot.thumbTip.visible = true;
    slot.indexTip.visible = true;
    slot.thumbTip.position.copy(thumb.position);
    slot.indexTip.position.copy(index.position);
    const d = thumb.position.distanceTo(index.position);
    const s = slot.pinching ? 1.6 : 1 + Math.max(0, 0.05 - d) * 10;
    slot.thumbTip.scale.setScalar(s);
    slot.indexTip.scale.setScalar(s);
  }

  _pinchState(slot) {
    const j = slot.hand.joints;
    const thumb = j && j['thumb-tip'];
    const index = j && j['index-finger-tip'];
    if (!thumb || !index || !thumb.visible || !index.visible) return null;
    const d = thumb.position.distanceTo(index.position);
    return { d, thumb, index };
  }

  _handMatrix(slot, point) {
    const wrist = slot.hand.joints && slot.hand.joints['wrist'];
    if (wrist) _q1.copy(wrist.quaternion);
    else _q1.identity();
    slot.handMatrix.compose(point, _q1, _one);
    return slot.handMatrix;
  }

  _twistAngle(slot) {
    const wrist = slot.hand.joints && slot.hand.joints['wrist'];
    if (!wrist) return 0;
    // Swing-twist decomposition around the forearm axis of the reference pose.
    _q2.copy(slot.twistRef).invert().premultiply(wrist.quaternion);
    _v1.set(0, 0, -1).applyQuaternion(slot.twistRef);
    const proj = _q2.x * _v1.x + _q2.y * _v1.y + _q2.z * _v1.z;
    return 2 * Math.atan2(proj, _q2.w);
  }

  // ------------------------------------------------------------ grab
  _grabInput(slot, time) {
    const id = this._grabId(slot);
    if (slot.isHand) {
      const ps = this._pinchState(slot);
      if (!ps) {
        if (slot.pinching) this._pinchEnd(slot);
        return;
      }
      _v1.addVectors(ps.thumb.position, ps.index.position).multiplyScalar(0.5);
      if (!slot.pinching && ps.d < PINCH_ON) {
        slot.pinching = true;
        this._pinchStart(slot, _v1.clone());
      } else if (slot.pinching && ps.d > PINCH_OFF) {
        this._pinchEnd(slot);
      } else if (slot.pinching) {
        if (slot.pinchMode === 'grab') this.game.updateGrab(id, this._handMatrix(slot, _v1), time);
        if (slot.pinchMode === 'place') {
          this.game.placementYaw = slot.twistBaseYaw + this._twistAngle(slot) * 1.5;
        }
      }
      return;
    }
    const gp = slot.source.gamepad;
    if (!gp) return;
    const squeeze = gp.buttons[1] && gp.buttons[1].pressed;
    if (squeeze && !slot.buttons[1]) {
      _v1.setFromMatrixPosition(slot.grip.matrixWorld);
      let piece = this.game.nearestPiece(_v1, GRAB_RADIUS);
      let matrix = slot.grip.matrixWorld;
      if (!piece) {
        _o.setFromMatrixPosition(slot.ray.matrixWorld);
        _d.set(0, 0, -1).transformDirection(slot.ray.matrixWorld);
        const pick = this.game.pickPiece(_o, _d, RAY_GRAB_DIST);
        if (pick) {
          piece = pick.piece;
          matrix = slot.ray.matrixWorld;
          slot.grabFromRay = true;
        }
      } else {
        slot.grabFromRay = false;
      }
      if (piece && this.game.beginGrab(id, piece, matrix)) {
        slot.grabbing = true;
        this._haptic(slot, 0.6, 40);
      }
    } else if (!squeeze && slot.buttons[1]) {
      if (slot.grabbing) this.game.endGrab(id);
      slot.grabbing = false;
    }
    if (slot.grabbing) this.game.updateGrab(id, slot.grabFromRay ? slot.ray.matrixWorld : slot.grip.matrixWorld, time);
    slot.buttons[1] = squeeze;
  }

  _pinchStart(slot, point) {
    const id = this._grabId(slot);
    const piece = this.game.nearestPiece(point, GRAB_RADIUS * 0.85);
    if (piece && this.game.beginGrab(id, piece, this._handMatrix(slot, point))) {
      slot.pinchMode = 'grab';
      slot.grabbing = true;
      return;
    }
    if (slot.handedness === 'left') {
      slot.pinchMode = null;
      return;
    }
    if (this.menu.hover >= 0) {
      this._activateMenu(this.menu.hover, slot);
      slot.pinchMode = 'menu';
      return;
    }
    const hit = this._lastHit();
    const tool = this.game.tool;
    if (tool === 'erase') {
      _o.setFromMatrixPosition(slot.ray.matrixWorld);
      _d.set(0, 0, -1).transformDirection(slot.ray.matrixWorld);
      this.game.eraseAt(_o, _d);
      slot.pinchMode = 'erase';
    } else if (tool === 'line') {
      slot.pinchMode = this.game.lineStart(hit) ? 'line' : null;
    } else {
      const wrist = slot.hand.joints && slot.hand.joints['wrist'];
      if (wrist) slot.twistRef.copy(wrist.quaternion);
      slot.twistBaseYaw = this.game.placementYaw;
      slot.pinchMode = 'place';
    }
  }

  _pinchEnd(slot) {
    const id = this._grabId(slot);
    slot.pinching = false;
    if (slot.pinchMode === 'grab') {
      this.game.endGrab(id);
      slot.grabbing = false;
    } else if (slot.pinchMode === 'line') {
      this.game.lineEnd();
    } else if (slot.pinchMode === 'place') {
      const hit = this._lastHit();
      this.game.placeAt(hit);
    }
    slot.pinchMode = null;
  }

  _lastHit() {
    const h = this.game.lastHit;
    return h.has ? h : null;
  }

  // -------------------------------------------------------- controller buttons
  _primaryButtons(slot, hit, menuHover, dt) {
    if (slot.isHand) return;
    const gp = slot.source.gamepad;
    if (!gp) return;
    const trigger = gp.buttons[0] && gp.buttons[0].pressed;
    if (trigger && !slot.buttons[0]) {
      if (menuHover >= 0) {
        this._activateMenu(menuHover, slot);
        slot.triggerMode = 'menu';
      } else if (this.game.tool === 'erase') {
        _o.setFromMatrixPosition(slot.ray.matrixWorld);
        _d.set(0, 0, -1).transformDirection(slot.ray.matrixWorld);
        if (this.game.eraseAt(_o, _d)) this._haptic(slot, 0.5, 30);
        slot.triggerMode = 'erase';
      } else if (this.game.tool === 'line') {
        slot.triggerMode = this.game.lineStart(hit) ? 'line' : null;
      } else {
        if (this.game.placeAt(hit)) this._haptic(slot, 0.35, 25);
        slot.triggerMode = 'place';
      }
    } else if (!trigger && slot.buttons[0]) {
      if (slot.triggerMode === 'line') {
        const n = this.game.lineEnd();
        if (n) this._haptic(slot, 0.5, 50);
      }
      slot.triggerMode = null;
    }
    slot.buttons[0] = trigger;

    // Thumbstick: x rotates the ghost, y cycles tools.
    const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
    const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
    if (Math.abs(ax) > 0.2) this.game.placementYaw -= ax * dt * 2.6;
    if (Math.abs(ay) > 0.7) {
      if (!slot.stickLatch) {
        slot.stickLatch = true;
        const i = TOOLS.findIndex((t) => t.id === this.game.tool);
        const next = TOOLS[(i + (ay > 0 ? 1 : -1) + TOOLS.length) % TOOLS.length];
        this.game.setTool(next.id);
        this.sound.uiClick();
      }
    } else if (Math.abs(ay) < 0.3) {
      slot.stickLatch = false;
    }
  }

  _faceButtons(slot, isPrimary) {
    const gp = slot.source.gamepad;
    if (!gp) return;
    const map = isPrimary ? { 4: 'start', 5: 'reset', 3: 'level' } : { 4: 'slowmo', 5: 'replay', 0: 'cycle' };
    for (const key of Object.keys(map)) {
      const i = Number(key);
      if (isPrimary && i === 0) continue;
      const b = gp.buttons[i];
      const pressed = !!(b && b.pressed);
      if (pressed && !slot.buttons[i]) {
        const act = map[key];
        if (act === 'cycle') {
          const idx = TOOLS.findIndex((t) => t.id === this.game.tool);
          this.game.setTool(TOOLS[(idx + 1) % TOOLS.length].id);
        } else {
          this.game.action(act);
        }
        this.sound.uiClick();
        this._haptic(slot, 0.3, 20);
      }
      slot.buttons[i] = pressed;
    }
  }
}
