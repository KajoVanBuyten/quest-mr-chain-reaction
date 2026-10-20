// GPU particle system: one instanced quad per particle, motion is evaluated
// entirely in the vertex shader from spawn data, so the CPU only writes a
// handful of floats when something is emitted.

import {
  AddEquation,
  BufferAttribute,
  CustomBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
} from 'three';

export const KIND_SPARK = 0;
export const KIND_DUST = 1;
export const KIND_CONFETTI = 2;
export const KIND_GLOW = 3;

const VERT = /* glsl */ `
attribute vec4 aStart;
attribute vec4 aVel;
attribute vec4 aColor;
attribute vec4 aMisc;
uniform float uTime;
varying vec4 vColor;
varying vec2 vUv;
varying float vKind;
varying float vT;
void main() {
  float age = uTime - aStart.w;
  float life = aVel.w;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = aMisc.y;
  vec3 disp = k > 0.0 ? aVel.xyz * (1.0 - exp(-k * age)) / k : aVel.xyz * age;
  vec3 pos = aStart.xyz + disp + vec3(0.0, -4.9 * aMisc.x * age * age, 0.0);
  float t = age / life;
  float size = aColor.w;
  float kind = aMisc.z;
  vec2 corner = position.xy;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  if (kind < 0.5) {
    vec3 vel = aVel.xyz * exp(-k * age) + vec3(0.0, -9.8 * aMisc.x * age, 0.0);
    vec3 vv = mat3(modelViewMatrix) * vel;
    float sl = length(vv.xy);
    vec2 dir = sl > 1e-4 ? vv.xy / sl : vec2(1.0, 0.0);
    float stretch = 1.0 + min(sl * 0.025 / max(size, 1e-4), 5.0);
    size *= (1.0 - t * 0.6);
    corner = dir * corner.x * stretch + vec2(-dir.y, dir.x) * corner.y;
  } else if (kind < 1.5) {
    size *= 0.6 + t * 1.8;
  } else if (kind < 2.5) {
    float a = aMisc.w * 6.2831 + age * (5.0 + aMisc.w * 9.0);
    float flip = 0.25 + 0.75 * abs(sin(age * 7.0 + aMisc.w * 11.0));
    corner = mat2(cos(a), -sin(a), sin(a), cos(a)) * (corner * vec2(1.0, flip));
  } else {
    size *= 0.5 + t * 1.2;
  }
  mv.xy += corner * size;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy + 0.5;
  vColor = aColor;
  vKind = kind;
  vT = t;
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
varying vec2 vUv;
varying float vKind;
varying float vT;
void main() {
  vec2 c = vUv - 0.5;
  float d = length(c) * 2.0;
  vec3 col = vColor.rgb;
  if (vKind < 0.5 || vKind > 2.5) {
    float a = clamp(1.0 - d, 0.0, 1.0);
    a *= a;
    float fade = 1.0 - vT;
    gl_FragColor = vec4(col * a * fade * 1.8, 0.0);
  } else if (vKind < 1.5) {
    float a = smoothstep(1.0, 0.1, d) * (1.0 - vT) * 0.42;
    gl_FragColor = vec4(col * a, a);
  } else {
    float fade = 1.0 - smoothstep(0.75, 1.0, vT);
    gl_FragColor = vec4(col * fade, fade);
  }
}`;

export class Particles {
  constructor(scene, capacity = 4096) {
    this.capacity = capacity;
    this.cursor = 0;
    this.pendingStart = 0;
    this.pendingCount = 0;
    this.time = 0;

    const geo = new InstancedBufferGeometry();
    geo.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = () => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.aStart = mk();
    this.aVel = mk();
    this.aColor = mk();
    this.aMisc = mk();
    for (let i = 0; i < capacity; i++) this.aStart.array[i * 4 + 3] = -1e4;
    geo.setAttribute('aStart', this.aStart);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aMisc', this.aMisc);
    geo.instanceCount = capacity;
    this.attrs = [this.aStart, this.aVel, this.aColor, this.aMisc];

    this.material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    scene.add(this.mesh);
  }

  spawn(x, y, z, vx, vy, vz, life, r, g, b, size, gravity, drag, kind) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.pendingCount === 0) this.pendingStart = i;
    this.pendingCount++;
    const o = i * 4;
    const s = this.aStart.array;
    s[o] = x;
    s[o + 1] = y;
    s[o + 2] = z;
    s[o + 3] = this.time;
    const v = this.aVel.array;
    v[o] = vx;
    v[o + 1] = vy;
    v[o + 2] = vz;
    v[o + 3] = life;
    const c = this.aColor.array;
    c[o] = r;
    c[o + 1] = g;
    c[o + 2] = b;
    c[o + 3] = size;
    const m = this.aMisc.array;
    m[o] = gravity;
    m[o + 1] = drag;
    m[o + 2] = kind;
    m[o + 3] = Math.random();
  }

  update(time) {
    this.time = time;
    this.material.uniforms.uTime.value = time;
    if (this.pendingCount === 0) return;
    const start = this.pendingStart;
    const count = Math.min(this.pendingCount, this.capacity);
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      if (count >= this.capacity) {
        a.addUpdateRange(0, this.capacity * 4);
      } else if (start + count <= this.capacity) {
        a.addUpdateRange(start * 4, count * 4);
      } else {
        a.addUpdateRange(start * 4, (this.capacity - start) * 4);
        a.addUpdateRange(0, (start + count - this.capacity) * 4);
      }
      a.needsUpdate = true;
    }
    this.pendingCount = 0;
  }

  clear() {
    for (let i = 0; i < this.capacity; i++) this.aStart.array[i * 4 + 3] = -1e4;
    this.pendingStart = 0;
    this.pendingCount = this.capacity;
  }
}
