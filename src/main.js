import './style.css';

const $ = (id) => document.getElementById(id);
const landing = $('landing');
const btnAR = $('btn-ar');
const btnVR = $('btn-vr');
const btnDesktop = $('btn-desktop');
const arSub = $('ar-sub');
const statusEl = $('status');
const toastEl = $('toast');

let app = null;
let arSupported = false;
let vrSupported = false;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

let toastTimer = 0;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function showLanding(show) {
  landing.classList.toggle('closed', !show);
  if (app) app.setDesktopActive(!show && !app.renderer.xr.isPresenting);
}

async function detectXR() {
  if (!window.isSecureContext) $('https-hint').classList.remove('hidden');
  if (!navigator.xr) {
    arSub.textContent = 'WebXR not available here';
    return;
  }
  try {
    arSupported = await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    arSupported = false;
  }
  try {
    vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
  } catch {
    vrSupported = false;
  }
  if (arSupported) {
    arSub.textContent = 'Passthrough mixed reality';
  } else {
    arSub.textContent = vrSupported ? 'AR not supported — try VR' : 'Open on Meta Quest 3';
    if (vrSupported) btnVR.classList.remove('hidden');
  }
  updateButtons();
}

function updateButtons() {
  btnAR.disabled = !app || !arSupported;
  btnVR.disabled = !app || !vrSupported;
  btnDesktop.disabled = !app;
}

async function enter(mode) {
  if (!app) return;
  try {
    const session = app.enterXR(mode);
    showLanding(false);
    await session;
  } catch (err) {
    console.error(err);
    showLanding(true);
    setStatus(`Could not start ${mode === 'immersive-ar' ? 'AR' : 'VR'}: ${err && err.message ? err.message : err}`, true);
  }
}

btnAR.addEventListener('click', () => enter('immersive-ar'));
btnVR.addEventListener('click', () => enter('immersive-vr'));
btnDesktop.addEventListener('click', () => showLanding(false));
$('hud-back').addEventListener('click', () => showLanding(true));

async function boot() {
  detectXR();
  try {
    const [rapierModule, { App }] = await Promise.all([import('@dimforge/rapier3d-compat'), import('./app.js')]);
    const RAPIER = rapierModule.default || rapierModule;
    await RAPIER.init();
    app = new App({
      container: $('app'),
      hudRoot: $('hud'),
      RAPIER,
      onSessionEnd: () => {
        showLanding(true);
        setStatus('Session ended — ready when you are.');
      },
      onInfo: (text) => toast(`Room: ${text}`),
    });
    setStatus('Ready. Put on your Quest 3 and press Enter AR — or preview right here.');
  } catch (err) {
    console.error(err);
    setStatus(`Failed to start: ${err && err.message ? err.message : err}`, true);
  }
  updateButtons();
}

boot();
