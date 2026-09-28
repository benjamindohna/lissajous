import * as THREE from 'three';
import { MAX_POINTS } from './stage';

export const TAU = Math.PI * 2;

// Farbverlauf entlang der Kurve, zyklisch (Anfang = Ende). Beim Themenwechsel
// blendet PALETTE weich zur neuen Zielpalette über.
const LUT_SIZE = 512;
export const PALETTE = new Float32Array(LUT_SIZE * 3);
const paletteTarget = new Float32Array(LUT_SIZE * 3);

function buildPalette(stops: string[], out: Float32Array) {
  const cols = [...stops, stops[0]].map((s) => new THREE.Color(s)); // wird linear gespeichert
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = (i / LUT_SIZE) * (cols.length - 1);
    const k = Math.floor(t);
    const f = t - k;
    const s = f * f * (3 - 2 * f);
    const a = cols[k];
    const b = cols[k + 1];
    out[i * 3] = a.r + (b.r - a.r) * s;
    out[i * 3 + 1] = a.g + (b.g - a.g) * s;
    out[i * 3 + 2] = a.b + (b.b - a.b) * s;
  }
}

export function setPalette(stops: string[], immediate = false) {
  buildPalette(stops, paletteTarget);
  if (immediate) PALETTE.set(paletteTarget);
}

export function stepPalette(dt: number) {
  const k = 1 - Math.exp(-dt * 5);
  for (let i = 0; i < PALETTE.length; i++) PALETTE[i] += (paletteTarget[i] - PALETTE[i]) * k;
}

export function paletteIndex(t: number) {
  const f = t - Math.floor(t);
  return Math.min(LUT_SIZE - 1, Math.floor(f * LUT_SIZE)) * 3;
}

/** Helligkeit: dichte (dissonante) Figuren leicht dimmen, sonst blüht alles zu */
export function intensity(a: number, b: number) {
  return 1 / Math.pow(1 + (a + b - 2) / 8, 0.35);
}

/**
 * Wabbeln: glattes Verschiebungsfeld über dem Raum (nicht über der Kurve),
 * damit Kreuzungspunkte zusammenbleiben und die Form als Ganzes atmet.
 */
export function wobble(x: number, y: number, t: number, amp: number, out: { x: number; y: number }) {
  if (amp <= 0) {
    out.x = x;
    out.y = y;
    return;
  }
  const dx =
    Math.sin(2.1 * x + 1.3 * y + 0.9 * t) * 0.55 +
    Math.sin(-3.7 * y + 1.7 * x + 1.45 * t + 1.3) * 0.3 +
    Math.sin(6.3 * x - 5.1 * y + 2.3 * t + 0.4) * 0.15;
  const dy =
    Math.sin(1.7 * x - 2.3 * y + 1.1 * t + 2.1) * 0.55 +
    Math.sin(3.3 * x + 1.1 * y - 1.25 * t + 0.4) * 0.3 +
    Math.sin(-5.7 * x + 6.1 * y + 2.1 * t + 2.7) * 0.15;
  const breathe = 1 + Math.sin(t * 0.8) * amp * 0.25;
  out.x = x * breathe + dx * amp;
  out.y = y * breathe + dy * amp;
}

/** Arbeitspuffer für die Linie */
export const pts = new Float32Array(MAX_POINTS * 3);
export const cols = new Float32Array(MAX_POINTS * 3);
