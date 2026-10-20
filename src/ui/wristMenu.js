// Tool palette rendered into a canvas texture and shown next to the left hand
// or controller in XR.

import { CanvasTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';
import { drawIcon } from './icons.js';
import { ALL_ITEMS } from './items.js';

const W = 512;
const HEADER = 136;
const H = HEADER + 512;
const PANEL_W = 0.15;
const PANEL_H = (PANEL_W * H) / W;

const _local = new Vector3();

export class WristMenu {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    // No mipmap chain to rebuild on every redraw (512x648 texture).
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.mesh = new Mesh(
      new PlaneGeometry(PANEL_W, PANEL_H),
      new MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthWrite: false }),
    );
    this.mesh.renderOrder = 30;
    this.group = new Group();
    this.group.add(this.mesh);
    this.group.visible = false;
    this.hover = -1;
    this.pressFlash = -1;
    this.pressT = 0;
    this.state = null;
    this.stateKey = '';
    this.sinceDraw = 1;
    this.items = ALL_ITEMS;
  }

  // state: { tool, slowmo, phase, score, toppled, total, combo, level, replaying, info }
  update(state, dt) {
    if (this.pressT > 0) {
      this.pressT = Math.max(0, this.pressT - dt * 4);
      if (this.pressT === 0) this.pressFlash = -1;
    }
    this.sinceDraw += dt;
    // Redraw + texture upload only while visible and at most ~15 times/s
    // (the score changes many times per second during a run).
    if (!this.group.visible || this.sinceDraw < 0.066) return;
    const key = [
      state.tool,
      state.slowmo,
      state.phase,
      state.score,
      state.toppled,
      state.total,
      state.combo,
      state.levelName,
      state.replaying,
      state.info,
      this.hover,
      this.pressFlash,
      Math.round(this.pressT * 5),
    ].join('|');
    if (key === this.stateKey) return;
    this.stateKey = key;
    this.state = state;
    this.sinceDraw = 0;
    this.redraw();
  }

  redraw() {
    const g = this.ctx;
    const s = this.state;
    g.clearRect(0, 0, W, H);
    g.save();
    g.fillStyle = 'rgba(7,10,22,0.9)';
    g.strokeStyle = 'rgba(80,220,255,0.75)';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(4, 4, W - 8, H - 8, 34);
    g.fill();
    g.stroke();
    g.restore();

    g.fillStyle = '#7ff3ff';
    g.font = '600 26px system-ui, sans-serif';
    g.textBaseline = 'top';
    g.fillText('CHAIN REACTION', 32, 22);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = '500 20px system-ui, sans-serif';
    g.fillText(s.info || s.levelName || '', 32, 56);
    g.fillStyle = '#ffffff';
    g.font = '700 30px system-ui, sans-serif';
    g.fillText(`${s.toppled}/${s.total}`, 32, 88);
    g.fillStyle = '#ffd35c';
    g.textAlign = 'right';
    g.fillText(String(s.score), W - 32, 22);
    g.font = '600 20px system-ui, sans-serif';
    g.fillStyle = s.slowmo ? '#c6a8ff' : 'rgba(255,255,255,0.45)';
    g.fillText(s.slowmo ? 'BULLET TIME' : s.phase.toUpperCase(), W - 32, 62);
    if (s.combo > 1) {
      g.fillStyle = '#ff5cd6';
      g.font = '700 26px system-ui, sans-serif';
      g.fillText(`COMBO x${s.combo}`, W - 32, 92);
    }
    g.textAlign = 'left';

    const tile = 128;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = col * tile;
      const y = HEADER + row * tile;
      const active =
        (it.kind === 'tool' && s.tool === it.id) || (it.id === 'slowmo' && s.slowmo) || (it.id === 'replay' && s.replaying);
      const hover = this.hover === i;
      const pressed = this.pressFlash === i;
      g.save();
      g.beginPath();
      g.roundRect(x + 10, y + 8, tile - 20, tile - 16, 22);
      if (active) {
        g.fillStyle = it.color + '40';
        g.fill();
        g.strokeStyle = it.color;
        g.lineWidth = 4;
        g.stroke();
      } else {
        g.fillStyle = pressed ? 'rgba(255,255,255,0.28)' : hover ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
        g.fill();
      }
      g.restore();
      drawIcon(g, it.id, x + tile / 2, y + tile / 2 - 12, 62, it.color);
      g.fillStyle = active ? '#ffffff' : 'rgba(255,255,255,0.75)';
      g.font = '600 17px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(it.label, x + tile / 2, y + tile - 38);
      g.textAlign = 'left';
    }
    this.texture.needsUpdate = true;
  }

  // Returns item index under a world-space point lying on/near the panel.
  indexAtWorldPoint(point) {
    this.mesh.worldToLocal(_local.copy(point));
    const u = _local.x / PANEL_W + 0.5;
    const v = 0.5 - _local.y / PANEL_H;
    if (u < 0 || u > 1 || v < 0 || v > 1) return -1;
    const py = v * H;
    if (py < HEADER) return -1;
    const col = Math.floor(u * 4);
    const row = Math.floor((py - HEADER) / 128);
    const idx = row * 4 + col;
    return idx >= 0 && idx < this.items.length ? idx : -1;
  }

  // Signed distance of a world point from the panel plane.
  planeDistance(point) {
    this.mesh.worldToLocal(_local.copy(point));
    return _local.z;
  }

  press(index) {
    this.pressFlash = index;
    this.pressT = 1;
    return this.items[index];
  }
}
