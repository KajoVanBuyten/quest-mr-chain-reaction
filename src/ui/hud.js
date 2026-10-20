// DOM toolbar and status bar for the desktop preview.

import { iconDataUrl } from './icons.js';
import { ACTIONS, TOOLS } from './items.js';

export class Hud {
  constructor(root, game, sound) {
    this.root = root;
    this.game = game;
    this.sound = sound;
    this.buttons = new Map();
    this.lastKey = '';

    this.status = root.querySelector('#hud-status');
    this.toolbar = root.querySelector('#hud-tools');
    this.actionsBar = root.querySelector('#hud-actions');
    this.scoreEl = root.querySelector('#hud-score');
    this.countEl = root.querySelector('#hud-count');
    this.comboEl = root.querySelector('#hud-combo');
    this.phaseEl = root.querySelector('#hud-phase');

    const make = (item, kind, parent) => {
      const b = document.createElement('button');
      b.className = 'hud-btn';
      b.type = 'button';
      b.title = `${item.label} (${item.key})`;
      b.style.setProperty('--accent', item.color);
      const img = document.createElement('img');
      img.src = iconDataUrl(item.id, item.color, 64);
      img.alt = '';
      const label = document.createElement('span');
      label.textContent = item.label;
      const key = document.createElement('kbd');
      key.textContent = item.key;
      b.append(img, label, key);
      b.addEventListener('click', () => {
        sound.init();
        sound.uiClick();
        if (kind === 'tool') game.setTool(item.id);
        else game.action(item.id);
        b.blur();
      });
      parent.append(b);
      this.buttons.set(item.id, b);
    };
    TOOLS.forEach((t) => make(t, 'tool', this.toolbar));
    ACTIONS.forEach((a) => make(a, 'action', this.actionsBar));
  }

  show(visible) {
    this.root.classList.toggle('visible', visible);
  }

  update() {
    const s = this.game.state;
    const key = [s.tool, s.slowmo, s.phase, s.score, s.toppled, s.total, s.combo, s.info, s.replaying].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (const [id, b] of this.buttons) {
      const active = id === s.tool || (id === 'slowmo' && s.slowmo) || (id === 'replay' && s.replaying);
      b.classList.toggle('active', active);
    }
    this.status.textContent = s.info;
    this.scoreEl.textContent = s.score.toLocaleString('en-US');
    this.countEl.textContent = `${s.toppled} / ${s.total}`;
    this.comboEl.textContent = s.combo > 1 ? `combo x${s.combo}` : '';
    this.phaseEl.textContent = s.slowmo ? 'bullet time' : s.phase;
  }
}
