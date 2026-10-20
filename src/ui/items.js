// Palette entries shared by the wrist menu (XR) and the desktop toolbar.

export const TOOLS = [
  { id: 'domino', label: 'Domino', key: '1', color: '#38e8ff' },
  { id: 'line', label: 'Domino Line', key: '2', color: '#5cffb0' },
  { id: 'marble', label: 'Marble', key: '3', color: '#ff5cd6' },
  { id: 'ramp', label: 'Ramp', key: '4', color: '#7aa8ff' },
  { id: 'pin', label: 'Pin', key: '5', color: '#ff6b8f' },
  { id: 'bumper', label: 'Bumper', key: '6', color: '#ff3df0' },
  { id: 'seesaw', label: 'Seesaw', key: '7', color: '#ffb547' },
  { id: 'barrel', label: 'Barrel', key: '8', color: '#ff5a36' },
  { id: 'trigger', label: 'Trigger', key: '9', color: '#2ff0ff' },
  { id: 'erase', label: 'Eraser', key: '0', color: '#c0c6dc' },
];

export const ACTIONS = [
  { id: 'start', label: 'Start', key: 'Space', color: '#5cff8a' },
  { id: 'reset', label: 'Reset', key: 'R', color: '#ffd35c' },
  { id: 'slowmo', label: 'Bullet Time', key: 'T', color: '#a98bff' },
  { id: 'replay', label: 'Replay', key: 'P', color: '#5cc8ff' },
  { id: 'level', label: 'Level', key: 'L', color: '#ff9f5c' },
  { id: 'clear', label: 'Clear', key: 'Del', color: '#ff5c7a' },
];

export const ALL_ITEMS = [...TOOLS.map((t) => ({ ...t, kind: 'tool' })), ...ACTIONS.map((a) => ({ ...a, kind: 'action' }))];
