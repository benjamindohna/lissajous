export interface Theme {
  id: string;
  name: string;
  stops: string[]; // Farbverlauf entlang der Kurve (zyklisch)
  accent: string;
  accent2: string;
  glow: string; // Kopf-Halo, Achsenpunkte
}

export const THEMES: Theme[] = [
  { id: 'aurora', name: 'Aurora', stops: ['#3ee0ff', '#4a7dff', '#a45bff', '#ff5fd2'], accent: '#5fe3ff', accent2: '#a45bff', glow: '#5fe3ff' },
  { id: 'glut', name: 'Glut', stops: ['#ffd36b', '#ff9a3c', '#ff5a36', '#e0245e'], accent: '#ffb347', accent2: '#ff5a36', glow: '#ff9a3c' },
  { id: 'radium', name: 'Radium', stops: ['#d4ff6b', '#5dff8f', '#1fd6b0', '#9dffe0'], accent: '#7dff9a', accent2: '#1fd6b0', glow: '#7dff9a' },
  { id: 'eis', name: 'Eis', stops: ['#ffffff', '#bfe6ff', '#7cb8ff', '#e6f4ff'], accent: '#bfe6ff', accent2: '#7cb8ff', glow: '#cfeeff' },
  { id: 'rose', name: 'Rosé', stops: ['#ffc2d6', '#ff7aa8', '#c86bff', '#ffb38a'], accent: '#ff8fb5', accent2: '#c86bff', glow: '#ff9ec0' },
];

export const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};
