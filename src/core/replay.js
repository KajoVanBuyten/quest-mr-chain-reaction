// Records body transforms of a run and plays them back (physics paused).
// Effects/sound events are recorded alongside so the replay sounds the same.

import { FIXED_DT } from './simulation.js';

const FRAME_STEPS = 2;
const FRAME_DT = FIXED_DT * FRAME_STEPS;
const STRIDE = 8;
const MAX_FLOATS = 6_000_000;

export class Recorder {
  constructor(sim) {
    this.sim = sim;
    this.recording = false;
    this.playing = false;
    this.frames = 0;
    this.data = null;
    this.events = [];
    this.pieces = [];
    this.bodyCount = 0;
    this.stepCounter = 0;
    this.time = 0;
    this.eventIndex = 0;
  }

  get hasRecording() {
    return this.frames > 2;
  }

  begin() {
    this.pieces = this.sim.pieces.slice();
    this.bodyCount = 0;
    for (const p of this.pieces) this.bodyCount += p.bodies.length;
    const stride = this.bodyCount * STRIDE;
    this.maxFrames = Math.max(2, Math.min(60 * 45, Math.floor(MAX_FLOATS / Math.max(1, stride))));
    const needed = stride * this.maxFrames;
    if (!this.data || this.data.length < needed) this.data = new Float32Array(needed);
    this.frames = 0;
    this.events.length = 0;
    this.stepCounter = 0;
    this.t0 = this.sim.simTime;
    this.recording = true;
    this.capture(true);
  }

  end() {
    this.recording = false;
  }

  clear() {
    this.recording = false;
    this.playing = false;
    this.frames = 0;
    this.events.length = 0;
    this.pieces = [];
  }

  capture(force = false) {
    if (!this.recording) return;
    if (!force && ++this.stepCounter % FRAME_STEPS !== 0) return;
    if (this.frames >= this.maxFrames) {
      this.recording = false;
      return;
    }
    const d = this.data;
    let o = this.frames * this.bodyCount * STRIDE;
    for (const p of this.pieces) {
      for (let i = 0; i < p.bodies.length; i++) {
        if (p.removed) {
          o += STRIDE;
          continue;
        }
        const buf = p.interp[i];
        d[o] = buf[7];
        d[o + 1] = buf[8];
        d[o + 2] = buf[9];
        d[o + 3] = buf[10];
        d[o + 4] = buf[11];
        d[o + 5] = buf[12];
        d[o + 6] = buf[13];
        d[o + 7] = p.bodies[i].isEnabled() ? 1 : 0;
        o += STRIDE;
      }
    }
    this.frames++;
  }

  event(type, x, y, z, a = 0, b = 0, ref = null) {
    if (!this.recording) return;
    this.events.push({ t: this.sim.simTime - this.t0, type, x, y, z, a, b, ref });
  }

  get duration() {
    return (this.frames - 1) * FRAME_DT;
  }

  startPlayback() {
    if (!this.hasRecording) return false;
    this.recording = false;
    this.playing = true;
    this.time = 0;
    this.eventIndex = 0;
    return true;
  }

  stopPlayback() {
    if (!this.playing) return;
    this.playing = false;
    for (const p of this.sim.pieces) {
      this.sim._captureInterp(p, true);
      p.hidden = p.type === 'barrel' && !p.bodies[0].isEnabled();
    }
  }

  /** Advances playback, writes poses into piece interpolation buffers. Returns alpha. */
  update(dt, timeScale, onEvent) {
    if (!this.playing) return 0;
    this.time += dt * timeScale;
    while (this.eventIndex < this.events.length && this.events[this.eventIndex].t <= this.time) {
      onEvent(this.events[this.eventIndex++]);
    }
    const f = this.time / FRAME_DT;
    let i0 = Math.floor(f);
    if (i0 >= this.frames - 1) {
      i0 = this.frames - 2;
      this._write(i0, 1);
      this.stopPlayback();
      return 1;
    }
    this._write(i0, f - i0);
    return f - i0;
  }

  _write(i0) {
    const d = this.data;
    const stride = this.bodyCount * STRIDE;
    let o0 = i0 * stride;
    let o1 = (i0 + 1) * stride;
    for (const p of this.pieces) {
      for (let i = 0; i < p.bodies.length; i++) {
        if (!p.removed) {
          const buf = p.interp[i];
          for (let k = 0; k < 7; k++) {
            buf[k] = d[o0 + k];
            buf[7 + k] = d[o1 + k];
          }
          if (i === 0) p.hidden = d[o1 + 7] < 0.5;
        }
        o0 += STRIDE;
        o1 += STRIDE;
      }
    }
  }
}
