// Piece dimensions and physics construction. Kept free of rendering code so the
// same definitions can be simulated headless when tuning the level layouts.

import { Quaternion, Vector3 } from 'three';

export const DIM = {
  domino: { w: 0.04, h: 0.08, d: 0.012 },
  marble: { r: 0.015 },
  trigger: { r: 0.034 },
  pin: { h: 0.095, base: 0.016, head: 0.0115 },
  barrel: { r: 0.038, h: 0.1 },
  bumper: { r: 0.045, h: 0.035 },
  ramp: { len: 0.4, w: 0.09, rise: 0.06, flat: 0.08, rail: 0.016 },
  seesaw: { len: 0.32, w: 0.07, t: 0.012, pivot: 0.036 },
};

export const PIECE_INFO = {
  domino: { scorable: true, dynamic: true, instanced: true },
  marble: { scorable: true, dynamic: true, instanced: true, ball: true },
  trigger: { scorable: false, dynamic: true, instanced: true, ball: true },
  pin: { scorable: true, dynamic: true, instanced: true },
  barrel: { scorable: true, dynamic: true, instanced: true, explosive: true },
  ramp: { scorable: false, dynamic: false },
  bumper: { scorable: false, dynamic: false },
  seesaw: { scorable: true, dynamic: false },
};

export const PIECE_TYPES = Object.keys(PIECE_INFO);

// Height of the body origin above the surface it is placed on.
export function spawnLift(type) {
  if (type === 'marble') return DIM.marble.r + 0.0015;
  if (type === 'trigger') return DIM.trigger.r + 0.002;
  return 0.0008;
}

const _q = new Quaternion();
const _v = new Vector3();
const _axisX = new Vector3(1, 0, 0);

function rot(q) {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

function eventsFlag(R) {
  return R.ActiveEvents.COLLISION_EVENTS;
}

function rampSlopeAngle() {
  const { len, rise, flat } = DIM.ramp;
  return Math.atan2(rise, len - flat);
}

/**
 * Builds all rigid bodies/colliders for a piece.
 * Returns { bodies: RigidBody[], colliders: Collider[], joints: ImpulseJoint[] }.
 * bodies[0] is the reference body that defines the piece pose.
 */
export function buildPiecePhysics(R, world, type, pos, quat) {
  const out = { bodies: [], colliders: [], joints: [] };
  const r = rot(quat);
  const ev = eventsFlag(R);

  const dyn = () =>
    R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation(r).setCanSleep(true);
  const fixed = () => R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(r);
  const add = (desc, body) => {
    const c = world.createCollider(desc, body);
    out.colliders.push(c);
    return c;
  };

  switch (type) {
    case 'domino': {
      const { w, h, d } = DIM.domino;
      const b = world.createRigidBody(dyn().setAngularDamping(0.08));
      out.bodies.push(b);
      add(
        R.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
          .setTranslation(0, h / 2, 0)
          .setDensity(700)
          .setFriction(0.42)
          .setRestitution(0.04)
          .setActiveEvents(ev),
        b,
      );
      break;
    }
    case 'marble': {
      const b = world.createRigidBody(
        dyn().setCcdEnabled(true).setLinearDamping(0.06).setAngularDamping(0.35),
      );
      out.bodies.push(b);
      add(
        R.ColliderDesc.ball(DIM.marble.r)
          .setDensity(2600)
          .setFriction(0.5)
          .setRestitution(0.35)
          .setActiveEvents(ev),
        b,
      );
      break;
    }
    case 'trigger': {
      const b = world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation(r)
          .setCcdEnabled(true)
          .setLinearDamping(0.05)
          .setAngularDamping(0.3),
      );
      out.bodies.push(b);
      add(
        R.ColliderDesc.ball(DIM.trigger.r)
          .setDensity(1400)
          .setFriction(0.6)
          .setRestitution(0.2)
          .setActiveEvents(ev),
        b,
      );
      break;
    }
    case 'pin': {
      const { base, head } = DIM.pin;
      const b = world.createRigidBody(dyn().setAngularDamping(0.1));
      out.bodies.push(b);
      add(
        R.ColliderDesc.cylinder(0.03, base)
          .setTranslation(0, 0.03, 0)
          .setDensity(300)
          .setFriction(0.4)
          .setRestitution(0.3)
          .setActiveEvents(ev),
        b,
      );
      add(
        R.ColliderDesc.ball(head)
          .setTranslation(0, 0.08, 0)
          .setDensity(300)
          .setFriction(0.4)
          .setRestitution(0.3)
          .setActiveEvents(ev),
        b,
      );
      break;
    }
    case 'barrel': {
      const { r: br, h } = DIM.barrel;
      const b = world.createRigidBody(dyn().setAngularDamping(0.1));
      out.bodies.push(b);
      add(
        R.ColliderDesc.cylinder(h / 2, br)
          .setTranslation(0, h / 2, 0)
          .setDensity(350)
          .setFriction(0.5)
          .setRestitution(0.15)
          .setActiveEvents(ev),
        b,
      );
      break;
    }
    case 'bumper': {
      const { r: br, h } = DIM.bumper;
      const b = world.createRigidBody(fixed());
      out.bodies.push(b);
      add(
        R.ColliderDesc.cylinder(h / 2, br)
          .setTranslation(0, h / 2, 0)
          .setRestitution(0.7)
          .setFriction(0.2)
          .setActiveEvents(ev),
        b,
      );
      break;
    }
    case 'ramp': {
      const { len, w, rise, flat, rail } = DIM.ramp;
      const b = world.createRigidBody(fixed());
      out.bodies.push(b);
      const z0 = -len / 2;
      const zf = z0 + flat;
      const z1 = len / 2;
      // Raised platform where a ball can wait.
      add(R.ColliderDesc.cuboid(w / 2, rise / 2, flat / 2).setTranslation(0, rise / 2, z0 + flat / 2).setFriction(0.6), b);
      // Solid wedge for the slope.
      const hw = w / 2;
      const wedge = new Float32Array([
        -hw, 0, zf, hw, 0, zf, -hw, rise, zf, hw, rise, zf, -hw, 0, z1, hw, 0, z1,
      ]);
      const wedgeDesc = R.ColliderDesc.convexHull(wedge);
      if (wedgeDesc) add(wedgeDesc.setFriction(0.5), b);
      // Side rails along the whole length and a back stop.
      const phi = rampSlopeAngle();
      const slopeLen = Math.hypot(z1 - zf, rise);
      _q.setFromAxisAngle(_axisX, phi);
      const nY = Math.cos(phi);
      const nZ = Math.sin(phi);
      for (const sx of [-1, 1]) {
        const x = sx * (hw + 0.003);
        add(
          R.ColliderDesc.cuboid(0.003, (rise + rail) / 2, flat / 2).setTranslation(x, (rise + rail) / 2, z0 + flat / 2),
          b,
        );
        add(
          R.ColliderDesc.cuboid(0.003, rail / 2, slopeLen / 2)
            .setTranslation(x, rise / 2 + nY * (rail / 2 - 0.002), (zf + z1) / 2 + nZ * (rail / 2 - 0.002))
            .setRotation(rot(_q)),
          b,
        );
      }
      add(R.ColliderDesc.cuboid(hw + 0.006, (rise + rail) / 2, 0.003).setTranslation(0, (rise + rail) / 2, z0 - 0.003), b);
      break;
    }
    case 'seesaw': {
      const { len, w, t, pivot } = DIM.seesaw;
      const base = world.createRigidBody(fixed());
      out.bodies.push(base);
      add(R.ColliderDesc.cuboid(w / 2, (pivot - 0.004) / 2, 0.012).setTranslation(0, (pivot - 0.004) / 2, 0), base);
      const plankQ = new Quaternion();
      extraBodyPose(type, 1, pos, quat, _v, plankQ);
      const plank = world.createRigidBody(
        R.RigidBodyDesc.dynamic().setTranslation(_v.x, _v.y, _v.z).setRotation(rot(plankQ)).setCanSleep(true).setAngularDamping(0.2),
      );
      out.bodies.push(plank);
      add(
        R.ColliderDesc.cuboid(w / 2, t / 2, len / 2).setDensity(500).setFriction(0.6).setRestitution(0.1).setActiveEvents(ev),
        plank,
      );
      const jd = R.JointData.revolute({ x: 0, y: pivot, z: 0 }, { x: 0, y: -t / 2, z: 0 }, { x: 1, y: 0, z: 0 });
      const joint = world.createImpulseJoint(jd, base, plank, true);
      if (joint.setLimits) joint.setLimits(-SEESAW_LIMIT, SEESAW_LIMIT);
      if (joint.setContactsEnabled) joint.setContactsEnabled(false);
      out.joints.push(joint);
      break;
    }
    default:
      throw new Error('Unknown piece type ' + type);
  }
  return out;
}

export const SEESAW_TILT = -0.25;
export const SEESAW_LIMIT = 0.27;
const _tilt = new Quaternion();
const _off = new Vector3();

// Resting pose of extra bodies (the seesaw plank starts tilted, near end down).
export function extraBodyPose(type, index, pos, quat, outPos, outQuat) {
  if (type === 'seesaw' && index === 1) {
    const { pivot, t } = DIM.seesaw;
    _tilt.setFromAxisAngle(_axisX, SEESAW_TILT);
    outQuat.copy(quat).multiply(_tilt);
    _off.set(0, t / 2, 0).applyQuaternion(outQuat);
    outPos.set(0, pivot, 0).applyQuaternion(quat).add(pos).add(_off);
    return;
  }
  outPos.copy(pos);
  outQuat.copy(quat);
}

export { rampSlopeAngle };
