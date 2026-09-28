export const MAX_TERM = 99;

export function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export function reduce(a: number, b: number): [number, number] {
  const g = gcd(a, b);
  return [a / g, b / g];
}

/** "2:3", "2/3", "2 zu 3", "2 3" → [2, 3] (gekürzt) oder null */
export function parseRatio(s: string): [number, number] | null {
  const m = s.trim().match(/^(\d{1,3})\s*(?::|\/|zu|\s)\s*(\d{1,3})$/i);
  if (!m) return null;
  const a = +m[1];
  const b = +m[2];
  if (!a || !b) return null;
  const r = reduce(a, b);
  if (r[0] > MAX_TERM || r[1] > MAX_TERM) return null;
  return r;
}

export interface Preset {
  name: string;
  a: number;
  b: number;
  consonant: boolean; // „harmonisch": Prime, Oktave, Quinte, Quarte, Terzen, Sexten
}

// Grob nach Konsonanz sortiert
export const PRESETS: Preset[] = [
  { name: 'Prime', a: 1, b: 1, consonant: true },
  { name: 'Oktave', a: 1, b: 2, consonant: true },
  { name: 'Quinte', a: 2, b: 3, consonant: true },
  { name: 'Quarte', a: 3, b: 4, consonant: true },
  { name: 'gr. Sexte', a: 3, b: 5, consonant: true },
  { name: 'gr. Terz', a: 4, b: 5, consonant: true },
  { name: 'kl. Terz', a: 5, b: 6, consonant: true },
  { name: 'kl. Sexte', a: 5, b: 8, consonant: true },
  { name: 'kl. Septime', a: 9, b: 16, consonant: false },
  { name: 'gr. Sekunde', a: 8, b: 9, consonant: false },
  { name: 'gr. Septime', a: 8, b: 15, consonant: false },
  { name: 'kl. Sekunde', a: 15, b: 16, consonant: false },
  { name: 'Tritonus', a: 32, b: 45, consonant: false },
];

export function intervalName(a: number, b: number): string | null {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const p = PRESETS.find((p) => p.a === lo && p.b === hi);
  if (!p) return null;
  return a > b ? `${p.name} abwärts` : p.name;
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'H'];

export function noteName(freq: number): { name: string; cents: number } {
  const midi = 69 + 12 * Math.log2(freq / 440);
  const n = Math.round(midi);
  const cents = Math.round((midi - n) * 100);
  const octave = Math.floor(n / 12) - 1;
  return { name: `${NOTE_NAMES[((n % 12) + 12) % 12]}${octave}`, cents };
}

export function formatNote(freq: number): string {
  const { name, cents } = noteName(freq);
  if (Math.abs(cents) < 2) return name;
  return `${name} ${cents > 0 ? '+' : '−'}${Math.abs(cents)} ct`;
}

/**
 * Kleinstes a (A-Schwingungen), bei dem r·a fast ganzzahlig ist. Der Rest
 * delta = r·a − b bestimmt, wie schnell die Figur driftet (dreht).
 */
export function approximate(r: number, tol = 0.03): { a: number; b: number; delta: number } {
  for (let a = 1; a <= MAX_TERM; a++) {
    const b = Math.round(r * a);
    const delta = r * a - b;
    if (b >= 1 && b <= MAX_TERM && Math.abs(delta) <= tol) return { a, b, delta };
  }
  const b = Math.max(1, Math.round(r * MAX_TERM));
  return { a: MAX_TERM, b, delta: r * MAX_TERM - b };
}

export const cents = (r: number) => 1200 * Math.log2(r);
