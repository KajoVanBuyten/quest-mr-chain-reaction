// Optional performance overlay (enable with ?stats in the URL).
// Desktop: a small DOM panel. XR: a head-locked canvas panel below the view.
// Values are aggregated over ~0.5 s and redrawn at 2 Hz to stay cheap.

import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

const W = 512;
const H = 176;

export class PerfHud {
  constructor(camera) {
    this.frames = 0;
    this.sum = { frame: 0, cpu: 0, phys: 0, render: 0 };
    this.max = { frame: 0, phys: 0 };
    this.windowStart = performance.now();
    this.lastStamp = 0;
    this.lines = ['', '', '', ''];

    this.el = document.createElement('div');
    this.el.className = 'perf-hud';
    document.body.appendChild(this.el);

    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.panel = new Mesh(
      new PlaneGeometry(0.16, (0.16 * H) / W),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.panel.position.set(0, -0.13, -0.5);
    this.panel.rotation.x = -0.25;
    this.panel.renderOrder = 999;
    this.panel.frustumCulled = false;
    this.panel.visible = false;
    camera.add(this.panel);
  }

  setXR(on) {
    this.panel.visible = on;
    this.el.style.display = on ? 'none' : '';
  }

  /**
   * frameStamp: rAF timestamp (ms); cpuMs: JS time of the loop without
   * rendering; physMs: physics time; renderMs: time spent in render().
   */
  record(frameStamp, cpuMs, physMs, renderMs, info, extra) {
    const dt = this.lastStamp ? frameStamp - this.lastStamp : 0;
    this.lastStamp = frameStamp;
    if (dt > 0 && dt < 500) {
      this.frames++;
      this.sum.frame += dt;
      if (dt > this.max.frame) this.max.frame = dt;
    }
    this.sum.cpu += cpuMs;
    this.sum.render += renderMs;
    this.sum.phys += physMs;
    if (physMs > this.max.phys) this.max.phys = physMs;

    const now = performance.now();
    if (now - this.windowStart < 500 || this.frames === 0) return;
    const n = this.frames;
    const avg = this.sum.frame / n;
    this.lines[0] = `${(1000 / avg).toFixed(0)} fps   frame ${avg.toFixed(1)} ms (max ${this.max.frame.toFixed(1)})`;
    this.lines[1] = `cpu ${(this.sum.cpu / n).toFixed(1)} ms   render ${(this.sum.render / n).toFixed(1)} ms`;
    this.lines[2] = `physics ${(this.sum.phys / n).toFixed(2)} ms (max ${this.max.phys.toFixed(1)})  steps ${extra.steps}`;
    this.lines[3] = `draws ${info.calls}   tris ${(info.triangles / 1000).toFixed(1)}k   pieces ${extra.pieces}${extra.note ? '   ' + extra.note : ''}`;
    this.sum.frame = this.sum.cpu = this.sum.phys = this.sum.render = 0;
    this.max.frame = this.max.phys = 0;
    this.frames = 0;
    this.windowStart = now;
    if (this.panel.visible) this._drawCanvas();
    else this.el.textContent = this.lines.join('\n');
  }

  _drawCanvas() {
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(5,8,18,0.78)';
    g.beginPath();
    g.roundRect(0, 0, W, H, 18);
    g.fill();
    g.font = '600 26px ui-monospace, monospace';
    g.textBaseline = 'top';
    for (let i = 0; i < this.lines.length; i++) {
      g.fillStyle = i === 0 ? '#7ff3ff' : '#e8ecff';
      g.fillText(this.lines[i], 18, 16 + i * 38);
    }
    this.texture.needsUpdate = true;
  }
}
