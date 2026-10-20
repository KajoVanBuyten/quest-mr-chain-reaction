// Vector icons drawn with the 2D canvas API. Used for the wrist menu texture
// and rasterised into data URLs for the desktop toolbar.

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function drawIcon(g, id, cx, cy, s, color) {
  g.save();
  g.translate(cx, cy);
  g.scale(s / 100, s / 100);
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = color;
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 12;
  switch (id) {
    case 'domino':
      roundRect(g, -18, -40, 36, 80, 7);
      g.stroke();
      g.beginPath();
      g.moveTo(-10, 0);
      g.lineTo(10, 0);
      g.stroke();
      for (const [x, y] of [[-7, -24], [7, -14], [0, 22]]) {
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'line':
      for (let i = 0; i < 5; i++) {
        const a = -0.9 + i * 0.45;
        const x = Math.sin(a) * 34;
        const y = 20 - Math.cos(a) * 34 + 14;
        g.save();
        g.translate(x, y);
        g.rotate(a + (i === 0 ? -0.5 : 0));
        roundRect(g, -6, -20, 12, 40, 3);
        g.stroke();
        g.restore();
      }
      break;
    case 'marble':
      g.beginPath();
      g.arc(0, 0, 30, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 0.5;
      g.beginPath();
      g.arc(-10, -10, 9, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.beginPath();
      g.moveTo(-46, 22);
      g.lineTo(-34, 18);
      g.moveTo(-48, 6);
      g.lineTo(-36, 4);
      g.stroke();
      break;
    case 'ramp':
      g.beginPath();
      g.moveTo(-42, 30);
      g.lineTo(42, 30);
      g.lineTo(-42, -16);
      g.closePath();
      g.stroke();
      g.beginPath();
      g.arc(-28, -30, 11, 0, Math.PI * 2);
      g.fill();
      break;
    case 'pin':
      g.beginPath();
      g.moveTo(-6, -42);
      g.bezierCurveTo(-16, -42, -14, -22, -8, -16);
      g.bezierCurveTo(-26, 0, -24, 30, -12, 42);
      g.lineTo(12, 42);
      g.bezierCurveTo(24, 30, 26, 0, 8, -16);
      g.bezierCurveTo(14, -22, 16, -42, 6, -42);
      g.closePath();
      g.stroke();
      g.beginPath();
      g.moveTo(-10, -10);
      g.lineTo(10, -10);
      g.stroke();
      break;
    case 'bumper':
      for (const r of [38, 24, 10]) {
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.stroke();
      }
      break;
    case 'seesaw':
      g.beginPath();
      g.moveTo(-14, 34);
      g.lineTo(14, 34);
      g.lineTo(0, 8);
      g.closePath();
      g.stroke();
      g.beginPath();
      g.moveTo(-44, 20);
      g.lineTo(44, -6);
      g.stroke();
      g.beginPath();
      g.arc(32, -22, 9, 0, Math.PI * 2);
      g.fill();
      break;
    case 'barrel':
      roundRect(g, -26, -38, 52, 76, 10);
      g.stroke();
      g.beginPath();
      g.moveTo(-26, -14);
      g.lineTo(26, -14);
      g.moveTo(-26, 14);
      g.lineTo(26, 14);
      g.stroke();
      g.font = 'bold 22px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('!', 0, 1);
      break;
    case 'trigger':
      g.beginPath();
      g.arc(-6, 0, 24, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(-6, 0, 36, 0, Math.PI * 2);
      g.globalAlpha = 0.5;
      g.stroke();
      g.globalAlpha = 1;
      g.beginPath();
      g.moveTo(34, -14);
      g.lineTo(48, 0);
      g.lineTo(34, 14);
      g.stroke();
      break;
    case 'erase':
      g.beginPath();
      g.arc(0, 0, 36, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(-16, -16);
      g.lineTo(16, 16);
      g.moveTo(16, -16);
      g.lineTo(-16, 16);
      g.stroke();
      break;
    case 'start':
      g.beginPath();
      g.moveTo(-22, -34);
      g.lineTo(34, 0);
      g.lineTo(-22, 34);
      g.closePath();
      g.fill();
      break;
    case 'reset':
      g.beginPath();
      g.arc(0, 0, 32, -Math.PI * 0.35, Math.PI * 1.45);
      g.stroke();
      g.beginPath();
      g.moveTo(20, -42);
      g.lineTo(24, -22);
      g.lineTo(4, -20);
      g.stroke();
      break;
    case 'slowmo':
      g.beginPath();
      g.moveTo(-26, -38);
      g.lineTo(26, -38);
      g.lineTo(-26, 38);
      g.lineTo(26, 38);
      g.closePath();
      g.stroke();
      g.globalAlpha = 0.6;
      g.beginPath();
      g.moveTo(-12, 30);
      g.lineTo(12, 30);
      g.lineTo(0, 16);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      break;
    case 'replay':
      for (const dx of [-16, 14]) {
        g.beginPath();
        g.moveTo(dx + 16, -28);
        g.lineTo(dx - 14, 0);
        g.lineTo(dx + 16, 28);
        g.closePath();
        g.fill();
      }
      break;
    case 'level':
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(0, -30 + i * 18);
        g.lineTo(38, -14 + i * 18);
        g.lineTo(0, 2 + i * 18);
        g.lineTo(-38, -14 + i * 18);
        g.closePath();
        g.globalAlpha = 1 - i * 0.25;
        g.stroke();
      }
      g.globalAlpha = 1;
      break;
    case 'clear':
      g.beginPath();
      g.moveTo(-30, -24);
      g.lineTo(30, -24);
      g.moveTo(-10, -24);
      g.lineTo(-8, -36);
      g.lineTo(8, -36);
      g.lineTo(10, -24);
      g.stroke();
      roundRect(g, -22, -16, 44, 54, 6);
      g.stroke();
      g.beginPath();
      g.moveTo(-8, -4);
      g.lineTo(-8, 26);
      g.moveTo(8, -4);
      g.lineTo(8, 26);
      g.stroke();
      break;
    default:
      g.beginPath();
      g.arc(0, 0, 30, 0, Math.PI * 2);
      g.stroke();
  }
  g.restore();
}

export function iconDataUrl(id, color, size = 64) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  drawIcon(c.getContext('2d'), id, size / 2, size / 2, size * 0.78, color);
  return c.toDataURL();
}
