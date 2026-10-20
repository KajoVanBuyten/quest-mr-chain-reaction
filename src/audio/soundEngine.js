// Procedural spatial audio. Every sound is synthesised with WebAudio nodes;
// no audio files are used. The frequent, short sounds (clicks, rolling) use
// cheap equal-power panners, HRTF is reserved for the few big events, and the
// number of concurrent voices is capped to keep the audio thread light.

import { Vector3 } from 'three';

const MAX_VOICES = 24;
const MIN_CLICK_GAP = 0.012;
const _pos = new Vector3();
const _fwd = new Vector3();
const _up = new Vector3();

function setParam(param, value, ctx) {
  if (param.setTargetAtTime) param.setTargetAtTime(value, ctx.currentTime, 0.02);
  else param.value = value;
}

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.voiceEnds = [];
    this.pitch = 1;
    this.lastClick = 0;
    this.muted = false;
    this.rollers = [];
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // Small procedural room reverb as a send.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.4, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);

    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.bus.connect(this.reverbSend);

    this.noise = this._noiseBuffer(1.5);
    this._setupRollers(6);
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (t < 0.01 ? t * 100 : 1);
      }
    }
    return buf;
  }

  _panner(x, y, z, ref = 0.35, hrtf = false) {
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = 30;
    p.rolloffFactor = 1;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
    p.connect(this.bus);
    return p;
  }

  _voice(duration) {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    const ends = this.voiceEnds;
    let n = 0;
    for (let i = 0; i < ends.length; i++) if (ends[i] > now) ends[n++] = ends[i];
    ends.length = n;
    if (n >= MAX_VOICES) return false;
    ends.push(now + duration + 0.05);
    return true;
  }

  setListener(matrixWorld) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    _pos.setFromMatrixPosition(matrixWorld);
    const e = matrixWorld.elements;
    _fwd.set(-e[8], -e[9], -e[10]).normalize();
    _up.set(e[4], e[5], e[6]).normalize();
    if (l.positionX) {
      l.positionX.value = _pos.x;
      l.positionY.value = _pos.y;
      l.positionZ.value = _pos.z;
      l.forwardX.value = _fwd.x;
      l.forwardY.value = _fwd.y;
      l.forwardZ.value = _fwd.z;
      l.upX.value = _up.x;
      l.upY.value = _up.y;
      l.upZ.value = _up.z;
    } else {
      l.setPosition(_pos.x, _pos.y, _pos.z);
      l.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z);
    }
  }

  // ------------------------------------------------------------ impacts
  click(x, y, z, intensity, kind = 'domino') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastClick < MIN_CLICK_GAP) return;
    this.lastClick = now;
    const vol = Math.min(1, 0.15 + intensity * 1.2);
    const dur = 0.09 / this.pitch;
    if (!this._voice(dur)) return;
    const out = this._panner(x, y, z);
    const g = ctx.createGain();
    g.connect(out);

    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.playbackRate.value = this.pitch;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    let f0;
    let tone;
    if (kind === 'pin') {
      f0 = 1400 + Math.random() * 700;
      tone = 620 + Math.random() * 260;
      bp.Q.value = 4;
    } else if (kind === 'marble') {
      f0 = 4200 + Math.random() * 1500;
      tone = 2600 + Math.random() * 1400;
      bp.Q.value = 10;
    } else if (kind === 'heavy') {
      f0 = 500 + Math.random() * 300;
      tone = 160 + Math.random() * 60;
      bp.Q.value = 2;
    } else {
      f0 = 2600 + Math.random() * 1800;
      tone = 1100 + Math.random() * 700;
      bp.Q.value = 3.5;
    }
    bp.frequency.value = f0 * this.pitch;
    n.connect(bp);
    bp.connect(g);

    const o = ctx.createOscillator();
    o.type = kind === 'marble' ? 'sine' : 'triangle';
    o.frequency.setValueAtTime(tone * this.pitch, now);
    o.frequency.exponentialRampToValueAtTime(tone * 0.7 * this.pitch, now + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * (kind === 'marble' ? 0.35 : 0.25), now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + dur * (kind === 'marble' ? 1.6 : 0.6));
    o.connect(og);
    og.connect(g);

    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    n.start(now, Math.random() * 1.2, dur + 0.02);
    o.start(now);
    o.stop(now + dur * 1.7);
  }

  boom(x, y, z) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const p = this.pitch;
    const dur = 1.6 / p;
    if (!this._voice(dur)) return;
    const out = this._panner(x, y, z, 1.2, true);

    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    n.playbackRate.value = p;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600 * p, now);
    lp.frequency.exponentialRampToValueAtTime(90 * p, now + dur * 0.8);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.exponentialRampToValueAtTime(1.2, now + 0.008);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    n.connect(lp);
    lp.connect(ng);
    ng.connect(out);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95 * p, now);
    o.frequency.exponentialRampToValueAtTime(32 * p, now + dur * 0.7);
    const og = ctx.createGain();
    og.gain.setValueAtTime(1.1, now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.8);
    o.connect(og);
    og.connect(out);

    n.start(now);
    n.stop(now + dur);
    o.start(now);
    o.stop(now + dur);

    // Crackle tail
    for (let i = 0; i < 4; i++) {
      const t = now + (0.08 + Math.random() * 0.5) / p;
      this._crackle(out, t);
    }
  }

  _crackle(out, t) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 2000 + Math.random() * 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    n.connect(bp);
    bp.connect(g);
    g.connect(out);
    n.start(t, Math.random(), 0.04);
  }

  boing(x, y, z) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const p = this.pitch;
    const dur = 0.45 / p;
    if (!this._voice(dur)) return;
    const out = this._panner(x, y, z, 0.35, true);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180 * p, now);
    o.frequency.exponentialRampToValueAtTime(620 * p, now + 0.05 / p);
    o.frequency.exponentialRampToValueAtTime(260 * p, now + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 28 * p;
    const lg = ctx.createGain();
    lg.gain.value = 30 * p;
    lfo.connect(lg);
    lg.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g);
    g.connect(out);
    o.start(now);
    lfo.start(now);
    o.stop(now + dur);
    lfo.stop(now + dur);
  }

  whoosh(x, y, z) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = 0.6;
    if (!this._voice(dur)) return;
    const out = this._panner(x, y, z, 0.35, true);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, now);
    bp.frequency.exponentialRampToValueAtTime(3500, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.5, now + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    n.connect(bp);
    bp.connect(g);
    g.connect(out);
    n.start(now, 0, dur);
    this.tone(880, 0.12, 0.15, 'sine', 0.05);
    this.tone(1320, 0.18, 0.12, 'sine', 0.12);
  }

  pop(x, y, z) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (!this._voice(0.15)) return;
    const out = this._panner(x, y, z);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(900, now);
    o.frequency.exponentialRampToValueAtTime(160, now + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    o.connect(g);
    g.connect(out);
    o.start(now);
    o.stop(now + 0.15);
  }

  place(x, y, z) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (!this._voice(0.12)) return;
    const out = this._panner(x, y, z);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, now);
    o.frequency.exponentialRampToValueAtTime(1040, now + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(g);
    g.connect(out);
    o.start(now);
    o.stop(now + 0.13);
  }

  // Non-spatial UI tone.
  tone(freq, dur = 0.08, vol = 0.12, type = 'sine', delay = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    g.connect(this.reverbSend);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  uiClick() {
    this.tone(1250, 0.05, 0.08, 'sine');
  }

  combo(level) {
    const base = 523.25 * Math.pow(2, Math.min(level, 12) / 12);
    this.tone(base, 0.25, 0.1, 'triangle');
    this.tone(base * 1.5, 0.3, 0.06, 'sine', 0.04);
  }

  fanfare(perfect) {
    const notes = perfect ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568] : [392, 523.25, 659.25];
    notes.forEach((f, i) => {
      this.tone(f, 0.5, 0.12, 'triangle', i * 0.09);
      this.tone(f * 2, 0.35, 0.04, 'sine', i * 0.09 + 0.02);
    });
  }

  slowmo(on) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(on ? 420 : 120, now);
    o.frequency.exponentialRampToValueAtTime(on ? 90 : 460, now + 0.35);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    o.start(now);
    o.stop(now + 0.42);
  }

  // ------------------------------------------------------------ rolling
  _setupRollers(n) {
    const ctx = this.ctx;
    for (let i = 0; i < n; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 400;
      bp.Q.value = 1.4;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = this._panner(0, 0, 0, 0.3);
      src.connect(bp);
      bp.connect(lp);
      lp.connect(g);
      g.connect(pan);
      src.start(0, Math.random());
      this.rollers.push({ src, bp, g, pan, piece: null });
    }
  }

  updateRoller(index, x, y, z, speed, rolling, heavy) {
    const r = this.rollers[index];
    if (!r) return;
    const ctx = this.ctx;
    const p = r.pan;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    }
    const target = this.muted || !rolling ? 0 : Math.min(0.5, speed * (heavy ? 0.8 : 0.55));
    setParam(r.g.gain, target, ctx);
    setParam(r.bp.frequency, (heavy ? 140 : 260) + speed * (heavy ? 260 : 700) * this.pitch, ctx);
    r.src.playbackRate.value = 0.5 + Math.min(speed, 2) * 0.4 * this.pitch;
  }

  silenceRollers() {
    if (!this.ctx) return;
    for (let i = 0; i < this.rollers.length; i++) setParam(this.rollers[i].g.gain, 0, this.ctx);
  }

  get rollerCount() {
    return this.rollers.length;
  }
}
