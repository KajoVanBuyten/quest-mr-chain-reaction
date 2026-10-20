// High-level effects built on top of the particle system: sparks, dust,
// explosions with shockwave + light flash, confetti.

import {
  AdditiveBlending,
  Color,
  Mesh,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  MeshBasicMaterial,
} from 'three';
import { KIND_CONFETTI, KIND_DUST, KIND_GLOW, KIND_SPARK, Particles } from './particles.js';

const RING_FRAG = /* glsl */ `
uniform float uProgress;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float r = uProgress;
  float w = 0.06 + 0.12 * (1.0 - uProgress);
  float ring = smoothstep(r - w, r, d) * (1.0 - smoothstep(r, r + 0.02, d));
  float inner = smoothstep(r, 0.0, d) * 0.18;
  float a = (ring + inner) * (1.0 - uProgress);
  gl_FragColor = vec4(uColor * a * 2.0, 0.0);
}`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CONFETTI_COLORS = [
  [1, 0.24, 0.6],
  [0.2, 0.95, 1],
  [1, 0.84, 0.2],
  [0.5, 1, 0.4],
  [0.66, 0.45, 1],
  [1, 1, 1],
];

export class Effects {
  constructor(scene, { lowCost = false } = {}) {
    this.scene = scene;
    this.particles = new Particles(scene, lowCost ? 3072 : 6144);
    this.time = 0;
    this.lowCost = lowCost;

    this.rings = [];
    const ringGeo = new PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const mat = new ShaderMaterial({
        uniforms: { uProgress: { value: 1 }, uColor: { value: new Color(1, 0.55, 0.2) } },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const mesh = new Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 19;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.rings.push({ mesh, t: 1, dur: 0.6, size: 1 });
    }

    this.fireball = new Mesh(
      new SphereGeometry(1, 20, 14),
      new MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
    );
    this.fireball.visible = false;
    this.fireball.renderOrder = 18;
    scene.add(this.fireball);
    this.fireT = 1;

    // One persistent light so the shader permutation never changes while
    // playing. In XR it is switched off (every PBR fragment would pay for it)
    // and the flash is faked with additive glow sprites instead.
    this.flash = new PointLight(0xff9a40, 0, 2.5, 2);
    this.flash.castShadow = false;
    scene.add(this.flash);
    this.flashLevel = 0;
    this.lightFlash = true;
  }

  setLightFlash(enabled) {
    this.lightFlash = enabled;
    this.flash.visible = enabled;
    if (!enabled) {
      this.flashLevel = 0;
      this.flash.intensity = 0;
    }
  }

  sparks(x, y, z, count, r = 1, g = 0.85, b = 0.45, speed = 1.2, size = 0.006) {
    const p = this.particles;
    for (let i = 0; i < count; i++) {
      const th = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.2;
      const s = speed * (0.4 + Math.random() * 0.8);
      p.spawn(
        x,
        y,
        z,
        Math.cos(th) * s,
        up * s,
        Math.sin(th) * s,
        0.25 + Math.random() * 0.35,
        r,
        g,
        b,
        size * (0.6 + Math.random() * 0.8),
        0.6,
        2.5,
        KIND_SPARK,
      );
    }
  }

  dust(x, y, z, count, size = 0.03, tone = 0.85) {
    const p = this.particles;
    for (let i = 0; i < count; i++) {
      const th = Math.random() * Math.PI * 2;
      const s = 0.08 + Math.random() * 0.18;
      p.spawn(
        x + Math.cos(th) * 0.01,
        y + 0.005,
        z + Math.sin(th) * 0.01,
        Math.cos(th) * s,
        0.04 + Math.random() * 0.08,
        Math.sin(th) * s,
        0.6 + Math.random() * 0.5,
        tone,
        tone * 0.97,
        tone * 1.02,
        size * (0.7 + Math.random() * 0.6),
        -0.02,
        3.5,
        KIND_DUST,
      );
    }
  }

  glow(x, y, z, r, g, b, size, life) {
    this.particles.spawn(x, y, z, 0, 0, 0, life, r, g, b, size, 0, 0, KIND_GLOW);
  }

  explosion(x, y, z) {
    const n = this.lowCost ? 0.6 : 1;
    this.sparks(x, y, z, Math.round(70 * n), 1, 0.7, 0.25, 2.6, 0.01);
    this.sparks(x, y, z, Math.round(30 * n), 1, 0.95, 0.7, 1.6, 0.007);
    for (let i = 0; i < 10 * n; i++) {
      const th = Math.random() * Math.PI * 2;
      const s = Math.random() * 0.5;
      this.particles.spawn(x, y, z, Math.cos(th) * s, 0.2 + Math.random() * 0.4, Math.sin(th) * s, 0.5 + Math.random() * 0.3, 1, 0.45 + Math.random() * 0.3, 0.1, 0.09 + Math.random() * 0.06, -0.1, 3, KIND_GLOW);
    }
    this.dust(x, y - 0.03, z, Math.round(26 * n), 0.07, 0.35);
    this.shockwave(x, y - 0.04, z, 0.9, 0.55);
    this.fireball.position.set(x, y, z);
    this.fireball.visible = true;
    this.fireT = 0;
    if (this.lightFlash) {
      this.flash.position.set(x, y + 0.08, z);
      this.flashLevel = 1;
    } else {
      this.glow(x, y + 0.04, z, 1, 0.62, 0.25, 0.42, 0.28);
      this.glow(x, y + 0.04, z, 1, 0.9, 0.6, 0.18, 0.18);
    }
  }

  shockwave(x, y, z, size, dur, r = 1, g = 0.55, b = 0.2) {
    let ring = this.rings[0];
    for (const rr of this.rings) if (rr.t >= 1) ring = rr;
    ring.mesh.position.set(x, y + 0.004, z);
    ring.mesh.visible = true;
    ring.mesh.material.uniforms.uColor.value.setRGB(r, g, b);
    ring.t = 0;
    ring.dur = dur;
    ring.size = size;
  }

  confetti(x, y, z, count) {
    const p = this.particles;
    for (let i = 0; i < count; i++) {
      const th = Math.random() * Math.PI * 2;
      const s = 0.3 + Math.random() * 1.1;
      const c = CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0];
      p.spawn(
        x + (Math.random() - 0.5) * 0.1,
        y,
        z + (Math.random() - 0.5) * 0.1,
        Math.cos(th) * s * 0.6,
        1.2 + Math.random() * 1.6,
        Math.sin(th) * s * 0.6,
        2.2 + Math.random() * 1.6,
        c[0],
        c[1],
        c[2],
        0.012 + Math.random() * 0.008,
        0.22,
        1.6,
        KIND_CONFETTI,
      );
    }
    this.sparks(x, y + 0.1, z, 40, 1, 0.95, 0.6, 1.4, 0.008);
  }

  update(time, dt) {
    this.time = time;
    this.particles.update(time);
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / r.dur);
      const e = 1 - Math.pow(1 - r.t, 3);
      r.mesh.material.uniforms.uProgress.value = e;
      const s = r.size;
      r.mesh.scale.set(s, 1, s);
      if (r.t >= 1) r.mesh.visible = false;
    }
    if (this.fireT < 1) {
      this.fireT = Math.min(1, this.fireT + dt / 0.35);
      const s = 0.03 + this.fireT * 0.14;
      this.fireball.scale.setScalar(s);
      this.fireball.material.opacity = (1 - this.fireT) * 0.8;
      if (this.fireT >= 1) this.fireball.visible = false;
    }
    if (this.flashLevel > 0) {
      this.flashLevel = Math.max(0, this.flashLevel - dt * 3.2);
      this.flash.intensity = this.flashLevel * this.flashLevel * 6;
    }
  }
}
