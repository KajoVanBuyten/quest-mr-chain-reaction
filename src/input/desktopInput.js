// Mouse / keyboard / touch controls for the desktop preview.

import { Matrix4, Quaternion, Vector2, Vector3 } from 'three';
import { TOOLS } from '../ui/items.js';

const _o = new Vector3();
const _d = new Vector3();
const _p = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _one = new Vector3(1, 1, 1);

export class DesktopInput {
  constructor({ dom, camera, controls, game, sound }) {
    this.dom = dom;
    this.camera = camera;
    this.controls = controls;
    this.game = game;
    this.sound = sound;
    this.ndc = new Vector2(0, 0);
    this.hasPointer = false;
    this.enabled = true;
    this.grabbing = false;
    this.grabDist = 1;
    this.down = null;
    this.hitScratch = { point: new Vector3(), normal: new Vector3() };

    dom.addEventListener('pointermove', (e) => this._move(e));
    dom.addEventListener('pointerdown', (e) => this._downEvt(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    dom.addEventListener('pointerleave', () => {
      this.hasPointer = false;
    });
    dom.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this._key(e));
  }

  _setNdc(e) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.hasPointer = true;
  }

  _ray() {
    _o.copy(this.camera.position);
    _d.set(this.ndc.x, this.ndc.y, 0.5).unproject(this.camera).sub(_o).normalize();
  }

  _move(e) {
    this._setNdc(e);
  }

  _downEvt(e) {
    if (!this.enabled) return;
    this._setNdc(e);
    this.sound.init();
    if (e.pointerType === 'touch') {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now(), touch: true };
      return;
    }
    if (e.button !== 0) return;
    this._primaryDown(e.shiftKey);
  }

  _primaryDown(shift) {
    const g = this.game;
    this._ray();
    const pick = g.pickPiece(_o, _d, 30);
    if (g.tool === 'erase') {
      if (pick) g.erase(pick.piece);
      return;
    }
    const surface = g.rayHit(_o, _d, 30, this.hitScratch);
    const pieceFirst = pick && (!surface || pick.distance <= surface.distance + 0.002);
    if (pieceFirst && (pick.piece.info.dynamic || shift)) {
      this.grabDist = pick.distance;
      _p.copy(_o).addScaledVector(_d, this.grabDist);
      _m.compose(_p, _q.identity(), _one);
      if (g.beginGrab('mouse', pick.piece, _m)) {
        this.grabbing = true;
        this.controls.enableZoom = false;
        this.dom.style.cursor = 'grabbing';
      }
      return;
    }
    if (g.tool === 'line') {
      g.lineStart(surface);
      return;
    }
    g.placeAt(surface);
  }

  _up(e) {
    if (this.down && this.down.touch) {
      const dx = e.clientX - this.down.x;
      const dy = e.clientY - this.down.y;
      const quick = performance.now() - this.down.t < 280 && dx * dx + dy * dy < 100;
      this.down = null;
      if (quick) {
        this._primaryDown(false);
        this._release();
      }
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this._release();
  }

  _release() {
    const g = this.game;
    if (g.lineActive) g.lineEnd();
    if (this.grabbing) {
      g.endGrab('mouse');
      this.grabbing = false;
      this.controls.enableZoom = true;
      this.dom.style.cursor = '';
    }
  }

  _wheel(e) {
    if (!this.grabbing) return;
    e.preventDefault();
    this.grabDist = Math.max(0.3, Math.min(6, this.grabDist * (1 + Math.sign(e.deltaY) * 0.08)));
  }

  _key(e) {
    if (!this.enabled || e.target instanceof HTMLInputElement) return;
    const g = this.game;
    const k = e.key;
    const tool = TOOLS.find((t) => t.key === k);
    if (tool) {
      g.setTool(tool.id);
      this.sound.uiClick();
      return;
    }
    switch (k) {
      case ' ':
        e.preventDefault();
        g.action('start');
        break;
      case 'r':
      case 'R':
        g.action('reset');
        break;
      case 't':
      case 'T':
        g.action('slowmo');
        break;
      case 'p':
      case 'P':
        g.action('replay');
        break;
      case 'l':
      case 'L':
        g.action('level');
        break;
      case 'Delete':
      case 'Backspace':
        g.action('clear');
        break;
      case 'q':
      case 'Q':
        g.placementYaw += Math.PI / 12;
        break;
      case 'e':
      case 'E':
        g.placementYaw -= Math.PI / 12;
        break;
      default:
        return;
    }
    this.sound.uiClick();
  }

  update(time) {
    const g = this.game;
    if (!this.enabled || !this.hasPointer) {
      if (!this.grabbing) g.hideGhost();
      return;
    }
    this._ray();
    if (this.grabbing) {
      g.hideGhost();
      _p.copy(_o).addScaledVector(_d, this.grabDist);
      _m.compose(_p, _q.identity(), _one);
      g.updateGrab('mouse', _m, time);
      return;
    }
    const hit = g.rayHit(_o, _d, 30, this.hitScratch);
    g.updateGhost(hit, _o, _d);
    if (g.lineActive) g.lineMove(hit);
  }
}
