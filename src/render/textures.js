// Procedurally painted canvas textures. Nothing is loaded from the network.

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, srgb = true) {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export function dominoTextures() {
  const w = 128;
  const h = 256;
  const base = canvas(w, h);
  const g = base.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#d9dcef');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(20,24,40,0.85)';
  g.fillRect(10, h / 2 - 4, w - 20, 8);

  const glow = canvas(w, h);
  const e = glow.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, w, h);
  e.fillStyle = '#fff';
  e.shadowColor = '#fff';
  e.shadowBlur = 10;
  e.fillRect(14, h / 2 - 2, w - 28, 4);
  const pips = [
    [0.3, 0.2],
    [0.7, 0.32],
    [0.5, 0.68],
    [0.3, 0.8],
    [0.7, 0.8],
  ];
  for (const [x, y] of pips) {
    e.beginPath();
    e.arc(x * w, y * h, 9, 0, Math.PI * 2);
    e.fill();
    g.fillStyle = 'rgba(30,34,60,0.9)';
    g.beginPath();
    g.arc(x * w, y * h, 10, 0, Math.PI * 2);
    g.fill();
  }
  // Thin glowing rim
  e.shadowBlur = 0;
  e.strokeStyle = 'rgba(255,255,255,0.55)';
  e.lineWidth = 4;
  e.strokeRect(2, 2, w - 4, h - 4);
  return { map: tex(base), emissiveMap: tex(glow) };
}

export function pinTextures() {
  const w = 64;
  const h = 256;
  const base = canvas(w, h);
  const g = base.getContext('2d');
  g.fillStyle = '#f6f6fb';
  g.fillRect(0, 0, w, h);
  const glow = canvas(w, h);
  const e = glow.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, w, h);
  // Lathe UV v runs bottom (0) to top (1); canvas y is flipped.
  const stripes = [0.66, 0.72];
  for (const s of stripes) {
    const y = (1 - s) * h;
    g.fillStyle = '#ff2d6f';
    g.fillRect(0, y - 6, w, 12);
    e.fillStyle = '#ff5590';
    e.fillRect(0, y - 5, w, 10);
  }
  return { map: tex(base), emissiveMap: tex(glow) };
}

export function barrelTextures() {
  const w = 256;
  const h = 128;
  const base = canvas(w, h);
  const g = base.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#b3121f');
  grad.addColorStop(0.5, '#e0242c');
  grad.addColorStop(1, '#8a0d18');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // Hazard band
  g.save();
  g.beginPath();
  g.rect(0, h * 0.38, w, h * 0.24);
  g.clip();
  g.fillStyle = '#ffcf1f';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#16161c';
  for (let x = -h; x < w + h; x += 26) {
    g.beginPath();
    g.moveTo(x, h * 0.62);
    g.lineTo(x + 13, h * 0.62);
    g.lineTo(x + 13 + h * 0.24, h * 0.38);
    g.lineTo(x + h * 0.24, h * 0.38);
    g.fill();
  }
  g.restore();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, h * 0.1, w, 5);
  g.fillRect(0, h * 0.86, w, 5);

  const glow = canvas(w, h);
  const e = glow.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, w, h);
  e.fillStyle = '#ff7a1a';
  e.fillRect(0, h * 0.12, w, 3);
  e.fillRect(0, h * 0.86, w, 3);
  e.fillStyle = '#ffb347';
  e.font = 'bold 22px sans-serif';
  e.textAlign = 'center';
  for (let i = 0; i < 2; i++) e.fillText('TNT', w * (0.25 + i * 0.5), h * 0.3);
  g.fillStyle = '#ffe9a8';
  g.font = 'bold 22px sans-serif';
  g.textAlign = 'center';
  for (let i = 0; i < 2; i++) g.fillText('TNT', w * (0.25 + i * 0.5), h * 0.3);
  return { map: tex(base), emissiveMap: tex(glow) };
}

export function triggerTexture() {
  const w = 256;
  const h = 128;
  const c = canvas(w, h);
  const e = c.getContext('2d');
  e.fillStyle = '#0a1830';
  e.fillRect(0, 0, w, h);
  e.strokeStyle = '#7ff6ff';
  e.lineWidth = 5;
  for (let i = 0; i < 6; i++) {
    e.beginPath();
    e.moveTo((i / 6) * w, 0);
    e.lineTo((i / 6) * w + w / 12, h);
    e.stroke();
  }
  e.fillStyle = '#ffffff';
  e.fillRect(0, h / 2 - 3, w, 6);
  return tex(c);
}

export function woodTexture(repeat = 6) {
  const w = 512;
  const h = 512;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#5b3a24';
  g.fillRect(0, 0, w, h);
  const planks = 6;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < planks; i++) {
    const y = (i / planks) * h;
    const tone = 70 + rnd() * 30;
    g.fillStyle = `rgb(${tone + 40},${tone},${tone * 0.6})`;
    g.fillRect(0, y + 1, w, h / planks - 2);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(40,22,10,${0.05 + rnd() * 0.12})`;
      g.lineWidth = 1 + rnd() * 2;
      const yy = y + rnd() * (h / planks);
      g.beginPath();
      g.moveTo(0, yy);
      g.bezierCurveTo(w * 0.3, yy + rnd() * 6 - 3, w * 0.6, yy + rnd() * 6 - 3, w, yy);
      g.stroke();
    }
    g.fillStyle = 'rgba(20,10,5,0.6)';
    g.fillRect(rnd() * w, y, 2, h / planks);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

export function fabricTexture() {
  const w = 128;
  const h = 128;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#2b3350';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

export function gridTexture() {
  const s = 256;
  const c = canvas(s, s);
  const g = c.getContext('2d');
  g.fillStyle = '#10131f';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(120,200,255,0.10)';
  g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    g.beginPath();
    g.moveTo((i / 8) * s, 0);
    g.lineTo((i / 8) * s, s);
    g.moveTo(0, (i / 8) * s);
    g.lineTo(s, (i / 8) * s);
    g.stroke();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(10, 10);
  return t;
}

export function glowSpriteTexture() {
  const s = 64;
  const c = canvas(s, s);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return tex(c);
}
