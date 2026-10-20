// Small pool of billboard sprites for combo counters and run results.

import { CanvasTexture, LinearFilter, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';

const CW = 512;
const CH = 160;

export class FloatingText {
  constructor(scene, count = 8) {
    this.items = [];
    for (let i = 0; i < count; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = CW;
      canvas.height = CH;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = LinearFilter;
      const mat = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      const sprite = new Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 40;
      scene.add(sprite);
      this.items.push({ sprite, canvas, texture, key: '', t: 1, life: 1, rise: 0.12, scale: 0.2, x: 0, y: 0, z: 0 });
    }
    this.next = 0;
  }

  show(text, x, y, z, { color = '#ffffff', glow = '#38e8ff', scale = 0.2, life = 1.4, sub = '' } = {}) {
    const key = `${text}|${sub}|${color}|${glow}`;
    // Reuse an idle sprite that already shows this text (e.g. repeated
    // "BOOM!") to skip the canvas redraw and texture upload.
    let it = null;
    for (const cand of this.items) {
      if (cand.t >= 1 && cand.key === key) {
        it = cand;
        break;
      }
    }
    if (!it) {
      it = this.items[this.next];
      this.next = (this.next + 1) % this.items.length;
    }
    if (it.key !== key) this._draw(it, key, text, color, glow, sub);
    it.t = 0;
    it.life = life;
    it.scale = scale;
    it.x = x;
    it.y = y;
    it.z = z;
    it.sprite.visible = true;
    it.sprite.position.set(x, y, z);
  }

  _draw(it, key, text, color, glow, sub) {
    it.key = key;
    const g = it.canvas.getContext('2d');
    g.clearRect(0, 0, CW, CH);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 ${sub ? 70 : 84}px system-ui, sans-serif`;
    g.shadowColor = glow;
    g.shadowBlur = 24;
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    const ty = sub ? 62 : CH / 2;
    g.strokeText(text, CW / 2, ty);
    g.fillStyle = color;
    g.fillText(text, CW / 2, ty);
    if (sub) {
      g.font = '600 34px system-ui, sans-serif';
      g.shadowBlur = 10;
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillText(sub, CW / 2, 126);
    }
    it.texture.needsUpdate = true;
  }

  update(dt) {
    for (const it of this.items) {
      if (it.t >= 1) continue;
      it.t = Math.min(1, it.t + dt / it.life);
      const pop = it.t < 0.12 ? 0.6 + (it.t / 0.12) * 0.5 : 1.1 - Math.min(0.1, (it.t - 0.12) * 0.4);
      it.sprite.scale.set(it.scale * pop, ((it.scale * CH) / CW) * pop, 1);
      it.sprite.position.set(it.x, it.y + it.t * it.rise, it.z);
      it.sprite.material.opacity = it.t > 0.7 ? 1 - (it.t - 0.7) / 0.3 : 1;
      if (it.t >= 1) it.sprite.visible = false;
    }
  }
}
