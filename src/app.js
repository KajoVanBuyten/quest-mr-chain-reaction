// Application shell: renderer, scene, lighting, desktop preview and the WebXR
// session lifecycle (immersive-ar with graceful VR / desktop fallbacks).

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Timer,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  MOUSE,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Simulation } from './core/simulation.js';
import { PieceViews } from './render/pieceViews.js';
import { Effects } from './fx/effects.js';
import { Trails } from './fx/trails.js';
import { FloatingText } from './ui/floatingText.js';
import { SoundEngine } from './audio/soundEngine.js';
import { Game } from './game.js';
import { DesktopRoom } from './world/desktopRoom.js';
import { XRRoom } from './world/xrRoom.js';
import { WristMenu } from './ui/wristMenu.js';
import { XRInput } from './input/xrInput.js';
import { DesktopInput } from './input/desktopInput.js';
import { Hud } from './ui/hud.js';

const DESKTOP_BG = new Color(0x0a0d17);

const AR_OPTIONAL = ['hit-test', 'plane-detection', 'mesh-detection', 'anchors', 'hand-tracking', 'depth-sensing'];
const DEPTH_INIT = {
  usagePreference: ['cpu-optimized', 'gpu-optimized'],
  dataFormatPreference: ['luminance-alpha', 'float32'],
};

// Depth occlusion shader with a small metric bias so objects resting on a
// real surface are not clipped by sensor noise.
const OCCLUSION_FRAG = /* glsl */ `
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;
uniform float uNear;
uniform float uFar;
uniform float uBias;
float toLinear(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
float toDepth(float l) {
  float z = (uFar + uNear - 2.0 * uNear * uFar / l) / (uFar - uNear);
  return z * 0.5 + 0.5;
}
void main() {
  vec2 coord = vec2(gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight);
  float d;
  if (coord.x >= 1.0) {
    d = texture(depthColor, vec3(coord.x - 1.0, coord.y, 1)).r;
  } else {
    d = texture(depthColor, vec3(coord.x, coord.y, 0)).r;
  }
  if (d >= 0.9999) {
    gl_FragDepth = d;
    return;
  }
  gl_FragDepth = clamp(toDepth(toLinear(d) + uBias), 0.0, 1.0);
}`;

const _v1 = new Vector3();
const _v2 = new Vector3();

export class App {
  constructor({ container, hudRoot, RAPIER, onSessionEnd, onInfo }) {
    this.container = container;
    this.onSessionEnd = onSessionEnd || (() => {});
    this.onInfo = onInfo || (() => {});
    this.mode = 'desktop';
    this.timer = new Timer();
    this.time = 0;

    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFoveation(1);
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new Scene();
    scene.background = DESKTOP_BG;
    scene.fog = new Fog(DESKTOP_BG, 7, 16);
    this.scene = scene;

    const pmrem = new PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.85;

    const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.02, 60);
    camera.position.set(0.1, 1.32, 0.85);
    this.camera = camera;
    scene.add(camera);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.74, -0.3);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.35;
    controls.maxDistance = 6;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
    controls.update();
    this.controls = controls;

    this._setupLights();

    this.sim = new Simulation(RAPIER);
    this.views = new PieceViews(scene, this.sim);
    this.effects = new Effects(scene);
    this.trails = new Trails(scene);
    this.text = new FloatingText(scene);
    this.sound = new SoundEngine();
    this.game = new Game({
      sim: this.sim,
      scene,
      views: this.views,
      effects: this.effects,
      trails: this.trails,
      text: this.text,
      sound: this.sound,
    });

    this.desktopRoom = new DesktopRoom(scene, this.sim);
    this.xrRoom = new XRRoom(scene, this.sim);
    this.game.surfaceProvider = () => (this.mode === 'ar' ? this.xrRoom.surfaces : this.desktopRoom ? this.desktopRoom.surfaces : []);

    this.menu = new WristMenu();
    scene.add(this.menu.group);
    this.xrInput = new XRInput({ renderer, scene, game: this.game, menu: this.menu, sound: this.sound });
    this.desktopInput = new DesktopInput({ dom: renderer.domElement, camera, controls, game: this.game, sound: this.sound });
    this.desktopInput.enabled = false;
    this.hud = new Hud(hudRoot, this.game, this.sound);

    this.anchorMarker = new Mesh(
      new RingGeometry(0.05, 0.058, 48).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0x46f2ff, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }),
    );
    this.anchorMarker.visible = false;
    scene.add(this.anchorMarker);
    this.anchor = null;
    this.pendingAnchor = null;

    this._setupComposer();
    window.addEventListener('resize', () => this._resize());

    const loadLevel = this.game.loadLevel.bind(this.game);
    this.game.loadLevel = (index) => {
      loadLevel(index);
      if (this.mode === 'ar') this._requestAnchorAtLayout();
    };

    this.game.viewerPosition.copy(camera.position);
    this.game.loadLevel(0);

    renderer.setAnimationLoop((t, frame) => this._loop(t, frame));
  }

  _setupLights() {
    const scene = this.scene;
    this.hemi = new HemisphereLight(0xdde8ff, 0x3a3040, 0.75);
    scene.add(this.hemi);
    const sun = new DirectionalLight(0xfff0de, 2.4);
    sun.position.set(1.4, 3.4, 1.2);
    sun.target.position.set(0, 0.74, -0.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.004;
    const sc = sun.shadow.camera;
    sc.left = -1.6;
    sc.right = 1.6;
    sc.top = 1.6;
    sc.bottom = -1.6;
    sc.near = 0.5;
    sc.far = 8;
    sc.updateProjectionMatrix();
    scene.add(sun, sun.target);
    this.sun = sun;

    this.accentA = new PointLight(0x46f2ff, 3, 6, 2);
    this.accentA.position.set(-2.4, 1.9, -2.6);
    this.accentB = new PointLight(0xff4fe0, 2.5, 6, 2);
    this.accentB.position.set(2.6, 1.4, -2.4);
    scene.add(this.accentA, this.accentB);
  }

  _setupComposer() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(w, h), 0.5, 0.5, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _resize() {
    if (this.renderer.xr.isPresenting) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  setDesktopActive(active) {
    this.desktopInput.enabled = active;
    this.hud.show(active);
    if (active) this.sound.init();
  }

  // ------------------------------------------------------------------- XR
  async enterXR(mode) {
    if (!navigator.xr) throw new Error('WebXR is not available in this browser.');
    this.sound.init();
    const isAR = mode === 'immersive-ar';
    const attempts = isAR
      ? [
          { requiredFeatures: ['local-floor'], optionalFeatures: AR_OPTIONAL, depthSensing: DEPTH_INIT },
          { requiredFeatures: ['local-floor'], optionalFeatures: AR_OPTIONAL.filter((f) => f !== 'depth-sensing') },
          { requiredFeatures: ['local-floor'], optionalFeatures: ['hit-test', 'hand-tracking'] },
          { requiredFeatures: ['local-floor'] },
        ]
      : [{ requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] }, { requiredFeatures: ['local-floor'] }];
    let session = null;
    let lastErr = null;
    for (const init of attempts) {
      try {
        session = await navigator.xr.requestSession(mode, init);
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!session) throw lastErr || new Error('Could not start the XR session.');

    this.renderer.xr.setFramebufferScaleFactor(isAR ? 1.0 : 1.0);
    session.addEventListener('end', () => this._onSessionEnd());
    await this.renderer.xr.setSession(session);
    this._onSessionStart(session, isAR ? 'ar' : 'vr');
    return session;
  }

  _onSessionStart(session, mode) {
    this.mode = mode;
    this.session = session;
    this.setDesktopActive(false);
    this.controls.enabled = false;
    const features = session.enabledFeatures || null;
    const has = (f) => (features ? features.includes(f) : true);
    this.features = {
      hitTest: has('hit-test'),
      planes: has('plane-detection'),
      meshes: has('mesh-detection'),
      anchors: has('anchors'),
      hands: has('hand-tracking'),
      depth: features ? features.includes('depth-sensing') : false,
    };

    if (mode === 'ar') {
      this.scene.background = null;
      this.scene.fog = null;
      this.renderer.setClearColor(0x000000, 0);
      if (this.desktopRoom) {
        this.desktopRoom.dispose();
        this.desktopRoom = null;
      }
      this.accentA.visible = false;
      this.accentB.visible = false;
      this.hemi.intensity = 1.0;
      this.sun.intensity = 1.8;
      this._setShadowSize(1024);
      this.game.clear();
      this.game.levelIndex = -1;
      this.xrRoom.start(this.camera.position, { planes: this.features.planes, meshes: this.features.meshes });
      this.xrRoom.setOcclusionMeshes(!this.features.depth);
      this.autoLevelAt = this.time + 2.5;
      this.autoLevelDeadline = this.time + 5;
    } else {
      // VR fallback keeps the virtual room; step back from the table.
      const base = this.renderer.xr.getReferenceSpace();
      if (base && typeof XRRigidTransform !== 'undefined') {
        this.renderer.xr.setReferenceSpace(base.getOffsetReferenceSpace(new XRRigidTransform({ x: 0, y: 0, z: -1.15 })));
      }
      this._setShadowSize(1024);
    }

    this.renderer.setPixelRatio(1);
    this.xrInput.start(session, this.renderer.xr.getReferenceSpace());
    this.welcomeAt = this.time + 0.8;
    this.anchor = null;
    this.anchorMarker.visible = false;
  }

  _onSessionEnd() {
    const wasAR = this.mode === 'ar';
    this.xrInput.end();
    if (wasAR) this.xrRoom.stop();
    this.mode = 'desktop';
    this.session = null;
    this.anchor = null;
    this.anchorMarker.visible = false;
    this.scene.background = DESKTOP_BG;
    this.scene.fog = new Fog(DESKTOP_BG, 7, 16);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.accentA.visible = true;
    this.accentB.visible = true;
    this.hemi.intensity = 0.75;
    this.sun.intensity = 2.4;
    this._setShadowSize(2048);
    this.sun.position.set(1.4, 3.4, 1.2);
    this.sun.target.position.set(0, 0.74, -0.3);
    if (wasAR) {
      this.game.clear();
      this.desktopRoom = new DesktopRoom(this.scene, this.sim);
      this.game.loadLevel(0);
    }
    this.controls.enabled = true;
    this._resize();
    this.onSessionEnd();
  }

  _setShadowSize(size) {
    const s = this.sun.shadow;
    if (s.mapSize.x === size) return;
    s.mapSize.set(size, size);
    if (s.map) {
      s.map.dispose();
      s.map = null;
    }
  }

  // ------------------------------------------------------------- per frame
  _loop(t, frame) {
    this.timer.update(t);
    const dt = Math.min(0.05, this.timer.getDelta());
    this.time += dt;
    const xr = this.renderer.xr;
    const presenting = xr.isPresenting;

    if (presenting && frame) {
      const refSpace = xr.getReferenceSpace();
      if (this.mode === 'ar') {
        this.xrRoom.update(frame, refSpace, dt);
        this._autoLevel();
        this._updateAnchor(frame, refSpace);
      }
      this.xrInput.update(frame, refSpace, dt, this.time, this.camera);
      this._patchDepthOcclusion();
      if (this.welcomeAt && this.time > this.welcomeAt) {
        this.welcomeAt = 0;
        _v1.set(0, 0, -0.9).applyQuaternion(this.camera.quaternion).add(this.camera.position);
        this.text.show('CHAIN REACTION', _v1.x, _v1.y + 0.05, _v1.z, {
          sub: 'Left wrist: tools · Trigger/pinch: place · A: start',
          scale: 0.5,
          life: 4.5,
        });
      }
    } else {
      this.controls.update();
      this.desktopInput.update(this.time);
    }

    this.game.viewerPosition.copy(this.camera.position);
    this.game.viewerForward = this.camera.getWorldDirection(_v2);
    this.game.update(dt, this.camera);
    if (presenting) this.menu.update(this.game.state, dt);
    else this.hud.update();
    this.sound.setListener(this.camera.matrixWorld);
    if (presenting && this.mode === 'ar') this._followShadows();

    if (presenting) this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
  }

  _autoLevel() {
    if (!this.autoLevelAt || this.time < this.autoLevelAt) return;
    const surfaces = this.xrRoom.surfaces;
    const ready = surfaces.length > 0 || this.time > this.autoLevelDeadline;
    if (!ready) return;
    this.autoLevelAt = 0;
    if (this.sim.pieces.length === 0) this.game.loadLevel(0);
    const s = this.xrRoom.summary;
    this.onInfo(`planes: ${s.planes}, meshes: ${s.meshes}`);
  }

  _requestAnchorAtLayout() {
    if (!this.features || !this.features.anchors) return;
    this.pendingAnchor = this.game._layoutCenter(new Vector3());
  }

  _updateAnchor(frame, refSpace) {
    if (this.pendingAnchor && typeof frame.createAnchor === 'function' && typeof XRRigidTransform !== 'undefined') {
      const p = this.pendingAnchor;
      this.pendingAnchor = null;
      try {
        frame
          .createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }), refSpace)
          .then((anchor) => {
            if (this.anchor && this.anchor.delete) this.anchor.delete();
            this.anchor = anchor;
          })
          .catch(() => {});
      } catch {
        /* anchors unsupported for this space */
      }
    }
    if (this.anchor) {
      const pose = frame.getPose(this.anchor.anchorSpace, refSpace);
      if (pose) {
        const p = pose.transform.position;
        this.anchorMarker.position.set(p.x, p.y + 0.002, p.z);
        this.anchorMarker.visible = this.sim.phase !== 'run';
        this.anchorMarker.material.opacity = 0.35 + Math.sin(this.time * 3) * 0.15;
      } else {
        this.anchorMarker.visible = false;
      }
    }
  }

  _followShadows() {
    if ((this.shadowTick = (this.shadowTick || 0) + 1) % 30 !== 0) return;
    const c = this.game._layoutCenter(_v1);
    this.sun.target.position.copy(c);
    this.sun.position.set(c.x + 0.7, c.y + 2.6, c.z + 0.5);
    const sc = this.sun.shadow.camera;
    if (sc.right !== 1.1) {
      sc.left = -1.1;
      sc.right = 1.1;
      sc.top = 1.1;
      sc.bottom = -1.1;
      sc.updateProjectionMatrix();
    }
  }

  _patchDepthOcclusion() {
    const xr = this.renderer.xr;
    if (typeof xr.getDepthSensingMesh !== 'function' || !xr.hasDepthSensing || !xr.hasDepthSensing()) return;
    const mesh = xr.getDepthSensingMesh();
    if (!mesh) return;
    const mat = mesh.material;
    if (!mat.userData.biased) {
      mat.userData.biased = true;
      mat.uniforms.uNear = { value: 0.1 };
      mat.uniforms.uFar = { value: 100 };
      mat.uniforms.uBias = { value: 0.02 };
      mat.fragmentShader = OCCLUSION_FRAG;
      mat.needsUpdate = true;
    }
    const cam = xr.getCamera();
    const near = cam.near > 0 ? cam.near : 0.1;
    const far = Number.isFinite(cam.far) && cam.far > near ? cam.far : 1000;
    mat.uniforms.uNear.value = near;
    mat.uniforms.uFar.value = far;
    if (this.xrRoom.useOcclusionMeshes) this.xrRoom.setOcclusionMeshes(false);
  }
}

