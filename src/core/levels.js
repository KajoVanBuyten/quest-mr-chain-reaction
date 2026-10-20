// Preset layouts. Coordinates are in a surface-local frame:
//   u = to the right of the player, v = away from the player, angle a measured
//   from +v towards +u. Each entry: { type, u, v, a, y }.

import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from 'three';
import { DIM, spawnLift } from './pieceDefs.js';

const SPACING = 0.05;
const PIN_FIRST = 0.05;
const PIN_GAP = 0.04;
const PIN_ROWS = 2;
const RING_PIN = 0.19;
const RING_DOM = 0.25;

function dominoCurve(points, spacing = SPACING) {
  const curve = new CatmullRomCurve3(
    points.map(([u, v]) => new Vector3(u, 0, v)),
    false,
    'centripetal',
  );
  const length = curve.getLength();
  const count = Math.max(2, Math.floor(length / spacing) + 1);
  const out = [];
  const p = new Vector3();
  const t = new Vector3();
  for (let i = 0; i < count; i++) {
    const s = Math.min(1, (i * spacing) / length);
    curve.getPointAt(s, p);
    curve.getTangentAt(s, t);
    out.push({ type: 'domino', u: p.x, v: p.z, a: Math.atan2(t.x, t.z) });
  }
  return out;
}

function spiral(cu, cv, r0, gap, turns, startAngle = 0, spacing = SPACING) {
  const pts = [];
  const steps = Math.ceil(turns * 64);
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * turns * Math.PI * 2;
    const r = r0 + (gap * th) / (Math.PI * 2);
    pts.push([cu + Math.sin(th + startAngle) * r, cv + Math.cos(th + startAngle) * r]);
  }
  return dominoCurve(pts, spacing);
}

function triggerBehind(first, dist = 0.075) {
  const du = Math.sin(first.a);
  const dv = Math.cos(first.a);
  return { type: 'trigger', u: first.u - du * dist, v: first.v - dv * dist, a: first.a };
}

function ahead(entry, dist) {
  return [entry.u + Math.sin(entry.a) * dist, entry.v + Math.cos(entry.a) * dist];
}

function pinWedge(u, v, a, rows = 3, gap = 0.042) {
  const out = [];
  const fu = Math.sin(a);
  const fv = Math.cos(a);
  const ru = Math.cos(a);
  const rv = -Math.sin(a);
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i <= row; i++) {
      const side = (i - row / 2) * gap;
      const fwd = row * gap * 0.866;
      out.push({ type: 'pin', u: u + fu * fwd + ru * side, v: v + fv * fwd + rv * side, a });
    }
  }
  return out;
}

function arc(type, cu, cv, radius, count, centerAngle, spread) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const th = centerAngle - spread / 2 + (count === 1 ? 0.5 : i / (count - 1)) * spread;
    out.push({ type, u: cu + Math.sin(th) * radius, v: cv + Math.cos(th) * radius, a: th });
  }
  return out;
}

function ring(type, cu, cv, radius, count, phase = 0) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const th = phase + (i / count) * Math.PI * 2;
    out.push({ type, u: cu + Math.sin(th) * radius, v: cv + Math.cos(th) * radius, a: th });
  }
  return out;
}

export const LEVELS = [
  {
    name: 'Warm-Up Curve',
    build() {
      const line = dominoCurve([
        [-0.32, -0.16],
        [-0.12, -0.16],
        [0.04, -0.1],
        [0.12, 0.02],
        [0.08, 0.14],
        [-0.06, 0.19],
        [-0.2, 0.17],
      ]);
      const last = line[line.length - 1];
      const [pu, pv] = ahead(last, PIN_FIRST);
      const pins = pinWedge(pu, pv, last.a, PIN_ROWS, PIN_GAP);
      return [triggerBehind(line[0]), ...line, ...pins];
    },
  },
  {
    name: 'Marble Run',
    build() {
      const { len, flat, rise } = DIM.ramp;
      const rampU = -0.36;
      const rampV = -0.08;
      const ramp = { type: 'ramp', u: rampU, v: rampV, a: 0 };
      const trigger = { type: 'trigger', u: rampU, v: rampV - len / 2 + flat / 2, a: 0, y: rise };
      const line = dominoCurve([
        [rampU, rampV + len / 2 + 0.07],
        [rampU, 0.27],
        [-0.27, 0.37],
        [-0.13, 0.38],
        [-0.04, 0.29],
        [-0.01, 0.16],
      ]);
      const last = line[line.length - 1];
      const [bu, bv] = ahead(last, 0.1);
      const barrel = { type: 'barrel', u: bu, v: bv, a: 0 };
      const pins = arc('pin', bu, bv, 0.1, 6, last.a, Math.PI * 1.35);
      const marbles = [
        { type: 'marble', u: bu - 0.15, v: bv - 0.05, a: 0 },
        { type: 'marble', u: bu - 0.05, v: bv - 0.16, a: 0 },
      ];
      const tail = dominoCurve([
        [bu + 0.14, bv + 0.01],
        [bu + 0.26, bv + 0.06],
        [bu + 0.34, bv + 0.18],
        [bu + 0.3, bv + 0.32],
      ]);
      return [ramp, trigger, ...line, barrel, ...pins, ...marbles, ...tail];
    },
  },
  {
    name: 'Big Bang Spiral',
    build() {
      const sp = spiral(-0.18, 0.02, 0.09, 0.13, 1.75, Math.PI);
      const last = sp[sp.length - 1];
      const out = [triggerBehind(sp[0]), ...sp];
      const [bu, bv] = ahead(last, 0.09);
      const dirU = Math.sin(last.a);
      const dirV = Math.cos(last.a);
      for (let i = 0; i < 3; i++) {
        out.push({ type: 'barrel', u: bu + dirU * i * 0.16, v: bv + dirV * i * 0.16, a: 0 });
      }
      const cu = bu + dirU * 0.16;
      const cv = bv + dirV * 0.16;
      out.push(...ring('pin', cu, cv, RING_PIN, 10, 0.2));
      out.push(...ring('domino', cu, cv, RING_DOM, 16, 0.0));
      return out;
    },
  },
  {
    name: 'Tipping Bridge',
    build() {
      const { len, flat, rise } = DIM.ramp;
      const rampU = -0.38;
      const rampV = -0.05;
      const ramp = { type: 'ramp', u: rampU, v: rampV, a: 0 };
      const trigger = { type: 'trigger', u: rampU, v: rampV - len / 2 + flat / 2, a: 0, y: rise };
      const seesawV = rampV + len / 2 + DIM.seesaw.len / 2 + 0.01;
      const seesaw = { type: 'seesaw', u: rampU, v: seesawV, a: 0 };
      const startV = seesawV + DIM.seesaw.len / 2 + 0.09;
      const line = dominoCurve([
        [rampU, startV],
        [rampU + 0.02, startV + 0.08],
        [rampU + 0.16, startV + 0.12],
        [rampU + 0.3, startV + 0.04],
        [rampU + 0.38, startV - 0.12],
        [rampU + 0.5, startV - 0.22],
        [rampU + 0.62, startV - 0.2],
      ]);
      const last = line[line.length - 1];
      const [bu, bv] = ahead(last, 0.1);
      return [
        ramp,
        trigger,
        seesaw,
        ...line,
        { type: 'barrel', u: bu, v: bv, a: 0 },
        ...arc('pin', bu, bv, 0.11, 7, last.a, Math.PI * 1.4),
        ...pinWedge(bu + 0.03, bv - 0.19, Math.PI, 3, 0.045),
      ];
    },
  },
];

const _m = new Matrix4();
const _x = new Vector3();
const _z = new Vector3();

/** Orientation whose local +Z points along `dir` and local +Y along `up`. */
export function basisQuaternion(dir, up, out) {
  _z.copy(dir).addScaledVector(up, -dir.dot(up)).normalize();
  _x.crossVectors(up, _z).normalize();
  _m.makeBasis(_x, up, _z);
  return out.setFromRotationMatrix(_m);
}

const boundsCache = new Map();

/** Footprint of a level layout in metres ({ w: across, d: depth }). */
export function levelBounds(index) {
  const i = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
  if (!boundsCache.has(i)) {
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const e of LEVELS[i].build()) {
      minU = Math.min(minU, e.u);
      maxU = Math.max(maxU, e.u);
      minV = Math.min(minV, e.v);
      maxV = Math.max(maxV, e.v);
    }
    boundsCache.set(i, { w: maxU - minU + 0.12, d: maxV - minV + 0.12 });
  }
  return boundsCache.get(i);
}

/**
 * Places a preset level into the simulation.
 * frame: { origin, right, forward, up } (Vector3, unit vectors)
 */
export function placeLevel(sim, index, frame) {
  const level = LEVELS[((index % LEVELS.length) + LEVELS.length) % LEVELS.length];
  const entries = level.build();
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const e of entries) {
    minU = Math.min(minU, e.u);
    maxU = Math.max(maxU, e.u);
    minV = Math.min(minV, e.v);
    maxV = Math.max(maxV, e.v);
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  const dir = new Vector3();
  const pos = new Vector3();
  const quat = new Quaternion();
  let dominoIndex = 0;
  const dominoCount = entries.filter((e) => e.type === 'domino').length || 1;
  const placed = [];
  for (const e of entries) {
    dir.copy(frame.forward).multiplyScalar(Math.cos(e.a)).addScaledVector(frame.right, Math.sin(e.a));
    basisQuaternion(dir, frame.up, quat);
    pos
      .copy(frame.origin)
      .addScaledVector(frame.right, e.u - cu)
      .addScaledVector(frame.forward, e.v - cv)
      .addScaledVector(frame.up, (e.y || 0) + spawnLift(e.type));
    const hue = e.type === 'domino' ? 0.52 + (dominoIndex++ / dominoCount) * 0.45 : Math.random();
    placed.push(sim.addPiece(e.type, pos, quat, { hue: hue % 1 }));
  }
  return { level, pieces: placed };
}
