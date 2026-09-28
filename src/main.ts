import './style.css';
import { Stage, AXIS, MAX_POINTS } from './stage';
import { pts, cols, PALETTE, paletteIndex, intensity, wobble, setPalette, stepPalette, TAU } from './figure';
import { AudioEngine, KLAENGE, sustainAmount, type Klang } from './audio';
import { PRESETS, MAX_TERM, reduce, intervalName, formatNote, approximate, cents } from './ratio';
import { THEMES, hexToRgb, type Theme } from './themes';

type Trail = 'tail' | 'keep';

const state = {
  r: 1.5, // Frequenzverhältnis B/A (Ziel)
  exact: [2, 3] as [number, number] | null, // gesetzt = sauberes Verhältnis (Button, Einrasten, Eingabe)
  phase: 0,
  base: 220,
  playing: true,
  snap: true,
  allIntervals: false, // sonst nur die harmonischen
  axisLabels: false,
  wobble: 0.4,
  tempo: 0.4, // Hz, sichtbare Schwingung von Ton A
  tempoV: 250, // Reglerstellung 0..1000
  trail: 'tail' as Trail,
  tail: 1.5, // Sekunden
  zen: false,
  theme: 'aurora',
  klang: 'weich' as Klang,
  volume: 0.8,
};

// Figur: a× A gegen b× B schließt sich (bei freien Verhältnissen die nächstliegende)
let fig = { a: 2, b: 3, delta: 0 };

const SNAP_CENTS = 35; // Fangbereich beim Loslassen
const NEAR_CENTS = 45; // bis hier „fast Quinte"
const TEMPO_MIN = 0.08;
const TEMPO_MAX = 24; // ganz rechts: Schläge sind zum gehaltenen Ton verschmolzen
const BRAKE_TAU = 0.22; // sanftes Bremsen beim Pausieren
const HEAD_FADE: [number, number] = [2.5, 8]; // Hz: Kopf/Blitzen → ruhige Form (vor dem Stroboskop-Effekt)
const GLIMMER: [number, number] = [8, 20]; // Hz: leichtes Glimmen/Flimmern der ruhigen Form
const MORPH_S = 0.45; // Formwechsel

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (v: number, d = 1) => v.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtFixed = (v: number, d: number) => v.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Regler-Abbildungen (logarithmisch, wo es sich musikalisch/zeitlich so anfühlt)
const baseFromSlider = (v: number) => 110 * Math.pow(2, (3 * v) / 1000);
const tempoFromSlider = (v: number) => TEMPO_MIN * Math.pow(TEMPO_MAX / TEMPO_MIN, v / 1000);
const tailFromSlider = (v: number) => 0.3 * Math.pow(5 / 0.3, v / 1000);
const ratioFromSlider = (v: number) => Math.pow(2, v / 10000);
const sliderFromRatio = (r: number) => Math.round(Math.min(1, Math.max(0, Math.log2(r))) * 10000);

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(`lissajous.${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(`lissajous.${k}`, v);
    } catch {
      /* privat/gesperrt – egal */
    }
  },
};

const canvas = $<HTMLCanvasElement>('c');
const stage = new Stage(canvas);
const audio = new AudioEngine();

let speed = 1; // 0..1, gebremst beim Pausieren

// zwei durchlaufende Phasen, B = rNow·A + off
let thA = 0;
let off = 0;
let thStart = 0; // Beginn der aktuellen Zeichnung
let lastThB = 0;
let rNow = state.r; // gleitet zum Ziel state.r

let flashX = 0;
let flashY = 0;
let schedA = 0; // bis hierhin sind Anschläge im Audio-Takt geplant
let schedB = 0;
let holdingBase = false;
let time = 0;
let frameNo = 0;

// Formwechsel-Morph: letzte gezeigte Form (ohne Wabbeln) als Ausgangspunkt
const shapeBuf = new Float32Array(MAX_POINTS * 2);
const morphFrom = new Float32Array(MAX_POINTS * 2);
let shapeN = 0;
let morphN = 0;
let morphT = 1;
let shapeA = 0;
let shapeB = 0;

const easeOutBack = (t: number) => {
  const c = 1.3;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};
const hash = (x: number) => {
  const h = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
};

const freqB = () => state.base * rNow;

// Intervalle in Reglerreihenfolge (tief → hoch)
const byPitch = [...PRESETS].sort((p, q) => p.b / p.a - q.b / q.a);
const visiblePresets = () => byPitch.filter((p) => state.allIntervals || p.consonant);

function nearestPreset(r: number) {
  let best = visiblePresets()[0];
  let diff = Infinity;
  for (const p of visiblePresets()) {
    const d = Math.abs(cents(r) - cents(p.b / p.a));
    if (d < diff) {
      diff = d;
      best = p;
    }
  }
  return { preset: best, cents: diff };
}

/* ---------- Anzeige ---------- */

const panel = $('panel');
const top = $('top');
const labA = $('labA');
const labB = $('labB');
const ratioInput = $<HTMLInputElement>('ratio');
const rSlider = $<HTMLInputElement>('rslider');

function ratioLabel() {
  if (state.exact) return `${state.exact[0]} : ${state.exact[1]}`;
  return `1 : ${fmtFixed(state.r, 3)}`;
}

function updateTexts() {
  const near = nearestPreset(state.r);
  let name: string;
  if (state.exact) name = intervalName(state.exact[0], state.exact[1]) ?? 'Eigenes Verhältnis';
  else if (near.cents < NEAR_CENTS) name = `fast ${near.preset.name}`;
  else name = 'Freies Verhältnis';
  $('nowName').textContent = name;
  $('nowRatio').textContent = ratioLabel();

  if (document.activeElement !== ratioInput) ratioInput.value = ratioLabel();
  labA.innerHTML = `<b>A</b>${fmt(state.base, 0)} Hz · ${formatNote(state.base)}`;
  const fb = state.base * state.r;
  labB.innerHTML = `<b>B</b>${fmt(fb, 0)} Hz · ${formatNote(fb)}`;
  $('baseVal').textContent = `${fmt(state.base, 0)} Hz · ${formatNote(state.base)}`;
  $('phaseVal').textContent = `${Math.round((state.phase / TAU) * 360)}°`;
  $('wobbleVal').textContent = state.wobble === 0 ? 'aus' : `${Math.round(state.wobble * 100)} %`;
  $('tempoVal').textContent =
    `${fmt(state.tempo, state.tempo < 1 ? 2 : state.tempo < 10 ? 1 : 0)} Hz`;
  $('tailVal').textContent = `${fmt(state.tail)} s`;
  $('volumeVal').textContent = state.volume === 0 ? 'stumm' : `${Math.round(state.volume * 100)} %`;

  // Buttons und Reglerpunkte markieren
  const ex = state.exact;
  document.querySelectorAll<HTMLElement>('[data-a]').forEach((el) => {
    const pa = +el.dataset.a!;
    const pb = +el.dataset.b!;
    const on = !!ex && ex[0] === pa && ex[1] === pb;
    if (on && !el.classList.contains('on') && el.classList.contains('chip') && !el.hidden) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }
    el.classList.toggle('on', on);
    el.classList.toggle('near', !on && Math.abs(cents(state.r) - cents(pb / pa)) < SNAP_CENTS);
  });
}

function placeAxisLabels() {
  const pa = stage.toScreen(1.04, AXIS);
  labA.style.transform = `translate(${pa.x}px, ${pa.y + 12}px) translateX(-100%)`;
  const pb = stage.toScreen(AXIS, 1.04);
  labB.style.transform = `translate(${pb.x - 4}px, ${pb.y - 10}px) translateY(-100%)`;
}
labA.style.left = labA.style.top = labB.style.left = labB.style.top = '0';

function layout() {
  const topInset = state.zen ? 0 : top.getBoundingClientRect().bottom + 8;
  const bottomInset = state.zen ? 0 : window.innerHeight - panel.getBoundingClientRect().top + 8;
  stage.layout(window.innerWidth, window.innerHeight, topInset, bottomInset);
}

/* ---------- Zustand ändern ---------- */

/** sauberes Verhältnis a:b (Button, Einrasten, Eingabe) */
function setExact(a: number, b: number) {
  const same = state.exact && state.exact[0] === a && state.exact[1] === b;
  if (same) return;
  state.exact = [a, b];
  state.r = b / a;
  fig = { a, b, delta: 0 };
  rSlider.value = String(sliderFromRatio(state.r));
  updateTexts();
}

/** freies Verhältnis vom Regler – schließt sich nie ganz, dreht sich langsam */
function setFree(r: number) {
  state.exact = null;
  state.r = r;
  fig = approximate(r);
  updateTexts();
}

const playBtn = $('playBtn');
function setPlaying(on: boolean) {
  if (on === state.playing) return;
  state.playing = on;
  playBtn.classList.toggle('on', on);
  if (!on) audio.release();
}

function applyTheme(t: Theme, immediate = false) {
  state.theme = t.id;
  setPalette(t.stops, immediate);
  stage.setGlow(t.glow);
  const root = document.documentElement.style;
  root.setProperty('--accent', t.accent);
  root.setProperty('--accent-rgb', hexToRgb(t.accent));
  root.setProperty('--accent2-rgb', hexToRgb(t.accent2));
  document.querySelectorAll<HTMLElement>('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.theme === t.id));
  store.set('theme', t.id);
}

function applyKlang(k: Klang) {
  state.klang = k;
  audio.setKlang(k);
  document.querySelectorAll<HTMLElement>('#klangSeg button').forEach((b) => b.classList.toggle('on', b.dataset.klang === k));
  store.set('klang', k);
}

function setAllIntervals(on: boolean) {
  state.allIntervals = on;
  $('allBtn').classList.toggle('on', on);
  document.querySelectorAll<HTMLElement>('[data-a]').forEach((el) => {
    const p = byPitch.find((q) => q.a === +el.dataset.a! && q.b === +el.dataset.b!);
    el.hidden = !on && !!p && !p.consonant;
  });
  store.set('allIntervals', on ? '1' : '0');
  updateTexts();
}

function setAxisLabels(on: boolean) {
  state.axisLabels = on;
  document.body.classList.toggle('axis-labels', on);
  $('axisBtn').classList.toggle('on', on);
  store.set('axisLabels', on ? '1' : '0');
}

let hintTimer = 0;
function setZen(on: boolean) {
  state.zen = on;
  document.body.classList.toggle('zen', on);
  if (on) toggleSheet(false);
  const hint = $('zenHint');
  clearTimeout(hintTimer);
  hint.classList.toggle('show', on);
  if (on) hintTimer = window.setTimeout(() => hint.classList.remove('show'), 2600);
  stage.setAxesDim(on ? 0.5 : 1);
  try {
    if (on && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {});
    if (!on && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
  } catch {
    /* iPhone kann kein Vollbild – egal */
  }
  layout();
}

/* ---------- Bedienung ---------- */

// Ton freischalten bei der ersten Geste (iOS/Chrome-Autoplay-Regeln)
let audioWasReady = false;
const unlock = () => {
  audioWasReady = audio.ready;
  audio.unlock();
};
window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });

playBtn.addEventListener('click', () => {
  // der erste Tipp startet nur den Ton, statt gleich zu pausieren
  if (!audioWasReady && state.playing) return;
  setPlaying(!state.playing);
});

// Intervall-Buttons und Punkte auf dem Regler
const presetsEl = $('presets');
const marksEl = $('marks');
byPitch.forEach((p) => {
  const el = document.createElement('button');
  el.className = 'chip';
  el.dataset.a = String(p.a);
  el.dataset.b = String(p.b);
  el.innerHTML = `<span class="n">${p.name}</span><span class="r">${p.a} : ${p.b}</span>`;
  el.addEventListener('click', () => setExact(p.a, p.b));
  presetsEl.appendChild(el);

  const m = document.createElement('span');
  m.className = 'mark';
  m.dataset.a = String(p.a);
  m.dataset.b = String(p.b);
  m.style.left = `${Math.log2(p.b / p.a) * 100}%`;
  marksEl.appendChild(m);
});
$('allBtn').addEventListener('click', () => setAllIntervals(!state.allIntervals));

// Verhältnis-Regler: frei ziehen, beim Loslassen einrasten
rSlider.addEventListener('input', () => setFree(ratioFromSlider(+rSlider.value)));
rSlider.addEventListener('change', () => {
  if (!state.snap || state.exact) return;
  const near = nearestPreset(state.r);
  if (near.cents <= SNAP_CENTS) setExact(near.preset.a, near.preset.b);
});
const snapBtn = $('snapBtn');
snapBtn.addEventListener('click', () => {
  state.snap = !state.snap;
  snapBtn.classList.toggle('on', state.snap);
});

// Verhältnis eintippen: „3:8", „3/8", „3 zu 8", auch „1 : 1,52"
function parseAny(s: string): { exact: [number, number] } | { r: number } | null {
  const m = s.trim().match(/^(\d+(?:[.,]\d+)?)\s*(?::|\/|zu|\s)\s*(\d+(?:[.,]\d+)?)$/i);
  if (!m) return null;
  const x = parseFloat(m[1].replace(',', '.'));
  const y = parseFloat(m[2].replace(',', '.'));
  if (!(x > 0) || !(y > 0)) return null;
  const r = y / x;
  if (r < 1 / 8 || r > 8) return null;
  if (Number.isInteger(x) && Number.isInteger(y)) {
    const [a, b] = reduce(x, y);
    if (a <= MAX_TERM && b <= MAX_TERM) return { exact: [a, b] };
  }
  return { r };
}
ratioInput.addEventListener('focus', () => ratioInput.select());
ratioInput.addEventListener('input', () => ratioInput.classList.remove('bad'));
ratioInput.addEventListener('change', () => {
  const res = parseAny(ratioInput.value);
  if (!res) {
    ratioInput.classList.remove('bad');
    void ratioInput.offsetWidth;
    ratioInput.classList.add('bad');
  } else if ('exact' in res) {
    setExact(res.exact[0], res.exact[1]);
  } else {
    setFree(res.r);
    rSlider.value = String(sliderFromRatio(res.r));
  }
  ratioInput.value = ratioLabel();
});
ratioInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ratioInput.blur();
  if (e.key === 'Escape') {
    ratioInput.value = ratioLabel();
    ratioInput.blur();
  }
});

const tempoSlider = $<HTMLInputElement>('tempo');
tempoSlider.addEventListener('input', () => {
  state.tempoV = +tempoSlider.value;
  state.tempo = tempoFromSlider(state.tempoV);
  updateTexts();
});

// Einstellungen
const sheet = $('sheet');
const setBtn = $('setBtn');
function toggleSheet(open = !!sheet.hidden) {
  sheet.hidden = !open;
  setBtn.classList.toggle('on', open);
}
setBtn.addEventListener('click', () => toggleSheet());
$('sheetClose').addEventListener('click', () => toggleSheet(false));
window.addEventListener('pointerdown', (e) => {
  if (sheet.hidden) return;
  const t = e.target as Node;
  if (!sheet.contains(t) && !setBtn.contains(t)) toggleSheet(false);
});

const swatchesEl = $('swatches');
for (const t of THEMES) {
  const el = document.createElement('button');
  el.className = 'swatch';
  el.dataset.theme = t.id;
  el.innerHTML = `<i style="background: conic-gradient(${[...t.stops, t.stops[0]].join(', ')}); box-shadow: 0 0 14px ${t.glow}66"></i>${t.name}`;
  el.addEventListener('click', () => applyTheme(t));
  swatchesEl.appendChild(el);
}
const klangEl = $('klangSeg');
for (const k of KLAENGE) {
  const el = document.createElement('button');
  el.dataset.klang = k.id;
  el.textContent = k.name;
  el.addEventListener('click', () => applyKlang(k.id));
  klangEl.appendChild(el);
}
$('axisBtn').addEventListener('click', () => setAxisLabels(!state.axisLabels));

const volumeSlider = $<HTMLInputElement>('volume');
volumeSlider.addEventListener('input', () => {
  state.volume = +volumeSlider.value / 100;
  audio.setVolume(state.volume);
  store.set('volume', String(state.volume));
  updateTexts();
});

const baseSlider = $<HTMLInputElement>('base');
baseSlider.addEventListener('pointerdown', () => {
  holdingBase = true;
});
const release = () => {
  if (!holdingBase) return;
  holdingBase = false;
  audio.quiet(0);
};
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
baseSlider.addEventListener('input', () => {
  state.base = baseFromSlider(+baseSlider.value);
  updateTexts();
});

const phaseSlider = $<HTMLInputElement>('phase');
phaseSlider.addEventListener('input', () => {
  const next = (+phaseSlider.value / 360) * TAU;
  off += next - state.phase;
  state.phase = next;
  updateTexts();
});
const wobbleSlider = $<HTMLInputElement>('wobble');
wobbleSlider.addEventListener('input', () => {
  state.wobble = +wobbleSlider.value / 100;
  updateTexts();
});
const tailSlider = $<HTMLInputElement>('tail');
tailSlider.addEventListener('input', () => {
  state.tail = tailFromSlider(+tailSlider.value);
  updateTexts();
});
document.querySelectorAll<HTMLButtonElement>('#trailSeg button').forEach((b) =>
  b.addEventListener('click', () => {
    state.trail = b.dataset.trail as Trail;
    document.body.classList.toggle('trail-keep', state.trail === 'keep');
    document.querySelectorAll<HTMLButtonElement>('#trailSeg button').forEach((x) => x.classList.toggle('on', x === b));
    thStart = thA;
  }),
);

$('restartBtn').addEventListener('click', () => {
  thStart = thA;
});
$('zenBtn').addEventListener('click', () => setZen(true));
canvas.addEventListener('click', () => {
  if (state.zen) setZen(false);
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && state.zen) setZen(false);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'h') setZen(!state.zen);
  else if (k === 'escape') {
    if (state.zen) setZen(false);
    else toggleSheet(false);
  } else if (k === ' ') {
    e.preventDefault();
    setPlaying(!state.playing);
  } else if (/^[1-9]$/.test(k)) {
    const p = visiblePresets()[+k - 1];
    if (p) setExact(p.a, p.b);
  }
});

new ResizeObserver(layout).observe(panel);
window.addEventListener('resize', layout);

/* ---------- Anschläge im Audio-Takt ---------- */

const LOOKAHEAD = 0.12;

/**
 * Nulldurchgänge der nächsten ~120 ms vorausberechnen und sample-genau als
 * Anschläge planen. Sind die Schläge so dicht, dass die Stimme ohnehin nicht
 * mehr abklingt, wird sie einfach gehalten.
 */
function scheduleHits(tempoEff: number, thB: number) {
  if (!audio.ready) return;
  const tNow = audio.now;
  const horizon = tNow + LOOKAHEAD;
  const wA = TAU * tempoEff;
  const sus = sustainAmount(tempoEff);
  const axes: [0 | 1, number, number][] = [
    [0, thA, wA],
    [1, thB, wA * rNow],
  ];
  for (const [axis, th, w] of axes) {
    let from = axis === 0 ? schedA : schedB;
    if (from < tNow) from = tNow;
    const rate = w / Math.PI; // zwei Nulldurchgänge pro Schwingung
    if (axis === 0 && holdingBase) {
      // Grundton wird gerade gehalten
    } else if (sus > 0.995) {
      audio.hold(axis);
    } else if (w > 1e-4) {
      let k = Math.floor((th + w * (from - tNow)) / Math.PI) + 1;
      for (let guard = 0; guard < 200; guard++, k++) {
        const t = tNow + (k * Math.PI - th) / w;
        if (t > horizon) break;
        if (t >= from) audio.strike(axis, t, rate, sus);
      }
    }
    if (axis === 0) schedA = horizon;
    else schedB = horizon;
  }
}

/* ---------- Schleife ---------- */

const w = { x: 0, y: 0 };
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  frameNo++;

  stepPalette(dt);
  speed += ((state.playing ? 1 : 0) - speed) * (1 - Math.exp(-dt / BRAKE_TAU));
  if (speed < 0.002 && !state.playing) speed = 0;

  // Verhältnis gleitet; die Phase von B wird so nachgeführt, dass der Punkt nicht springt
  const rTarget = state.r;
  const rNext = rNow * Math.pow(rTarget / rNow, 1 - Math.exp(-dt / 0.09));
  const rNew = Math.abs(rNext - rTarget) < 1e-5 * rTarget ? rTarget : rNext;
  off -= (rNew - rNow) * thA;
  rNow = rNew;

  const { a, b } = fig;
  const phase = state.phase;
  const amp = state.wobble * 0.035;
  const I = intensity(a, b);

  const tempoEff = state.tempo * speed;
  const omegaNom = TAU * state.tempo;
  const prevA = thA;
  thA += TAU * tempoEff * dt;

  // saubere Verhältnisse: Punkt gleitet auf die kanonische Spur
  if (state.exact && rNow === rTarget) {
    const k = Math.round(((off - phase) * a) / TAU);
    const target = phase + (TAU * k) / a;
    off += (target - off) * (1 - Math.exp(-dt / 0.35));
  }
  const thB = rNow * thA + off;

  // Gezeichnet wird immer die geschlossene Figur a:b. Bei freien Verhältnissen
  // wandert ihre Phase psi mit – so dreht sie sich, bleibt aber immer geschlossen.
  // Am Kopf (u = thA) stimmt sie exakt mit der echten Bewegung überein.
  const rho = b / a;
  const psi = off + (rNow - rho) * thA;

  // hv: Kopf, Nahtstelle, Achsenpunkte (weg, bevor der Stroboskop-Effekt einsetzt)
  // vs: ruhige, gleichmäßige Form; gl: bewusstes Glimmen bei hohem Tempo
  const lt = Math.log(Math.max(tempoEff, 1e-3));
  const vs = smoothstep(Math.log(HEAD_FADE[0]), Math.log(HEAD_FADE[1]), lt);
  const hv = 1 - vs;
  const gl = smoothstep(Math.log(GLIMMER[0]), Math.log(GLIMMER[1]), lt);
  if (state.playing) scheduleHits(tempoEff, thB);
  if (Math.floor(thA / Math.PI) > Math.floor(prevA / Math.PI)) flashX = Math.max(flashX, hv);
  if (Math.floor(thB / Math.PI) !== Math.floor(lastThB / Math.PI)) flashY = Math.max(flashY, hv);
  lastThB = thB;

  // Spur: ganze Figur in fester Reihenfolge (sonst wechselt an Kreuzungen,
  // welche Linie oben liegt) oder nur der Schweif hinter dem Kopf
  const keep = state.trail === 'keep';
  const full = TAU * a;
  const span0 = keep ? full : Math.min(full, omegaNom * state.tail);
  const whole = span0 >= full && thA - thStart >= full;
  const u0 = whole ? Math.floor(thA / full) * full : Math.max(thStart, thA - span0);
  const span = whole ? full : thA - u0;
  const n = Math.max(2, Math.min(MAX_POINTS, Math.ceil(((Math.max(1, rho) * span) / TAU) * 80) + 2));

  // Formwechsel: vom zuletzt gezeigten Bild weich (mit leichtem Überschwingen) in die neue Figur
  if (a !== shapeA || b !== shapeB) {
    if (shapeN > 1) {
      morphFrom.set(shapeBuf.subarray(0, shapeN * 2));
      morphN = shapeN;
      morphT = 0;
    }
    shapeA = a;
    shapeB = b;
  }
  morphT = Math.min(1, morphT + dt / MORPH_S);
  const mk = morphT >= 1 ? 1 : easeOutBack(morphT);

  const Id = I * 1.25;
  const shimmer = 0.22 * state.wobble * gl;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const u = u0 + span * f;
    let x = Math.sin(u);
    let y = Math.sin(rho * u + psi);
    if (mk < 1) {
      const j = f * (morphN - 1);
      const j0 = Math.floor(j);
      const j1 = Math.min(morphN - 1, j0 + 1);
      const t = j - j0;
      const ox = morphFrom[j0 * 2] + (morphFrom[j1 * 2] - morphFrom[j0 * 2]) * t;
      const oy = morphFrom[j0 * 2 + 1] + (morphFrom[j1 * 2 + 1] - morphFrom[j0 * 2 + 1]) * t;
      x = ox + (x - ox) * mk;
      y = oy + (y - oy) * mk;
    }
    shapeBuf[i * 2] = x; // gezeigte Form, Startpunkt für den nächsten Wechsel
    shapeBuf[i * 2 + 1] = y;
    wobble(x, y, time, amp, w);
    pts[i * 3] = w.x;
    pts[i * 3 + 1] = w.y;
    pts[i * 3 + 2] = 0;
    let age = (thA - u) / omegaNom;
    if (age < 0) age += full / omegaNom;
    let s: number;
    if (keep) s = Id * 0.5 + Id * 1.1 * Math.exp(-age / 0.45) + 1.1 * Math.exp(-age / 0.08);
    else s = Id * Math.pow(Math.max(0, 1 - age / state.tail), 1.6) + 1.1 * Math.exp(-age / 0.08);
    // schnell: gleichmäßig leuchtende Form, die leicht glimmt und flimmert
    let flicker = 1;
    if (gl > 0) {
      const chunk = Math.floor(f * 48);
      flicker = 1 + shimmer * Math.sin(f * TAU * 3 - time * 1.6) + 0.14 * gl * (hash(chunk * 3.1 + frameNo * 0.37) - 0.5);
    }
    s = (hv * s + vs * I) * flicker;
    const ci = paletteIndex(f * (span / full) + u0 / full);
    cols[i * 3] = PALETTE[ci] * s;
    cols[i * 3 + 1] = PALETTE[ci + 1] * s;
    cols[i * 3 + 2] = PALETTE[ci + 2] * s;
  }
  shapeN = n;
  stage.curve.set(pts, cols, n);
  wobble(Math.sin(thA), Math.sin(rNow * thA + off), time, amp, w);
  stage.setHead(w.x, w.y, 1 + 0.07 * Math.sin(time * 7));
  stage.setHeadVisibility(hv);

  const decay = Math.exp(-dt * 5);
  flashX *= decay;
  flashY *= decay;
  // schnell: statt hektischem Blitzen ein ruhiges Glimmen der Mittelmarkierungen
  const glim = gl * (0.22 + 0.1 * Math.sin(time * 1.7));
  stage.setTicks(Math.max(flashX, glim), Math.max(flashY, glim * (1 + 0.15 * Math.sin(time * 2.3 + 1))), hv);
  stage.bloom.strength = 0.75 + state.wobble * 0.18 * Math.sin(time * 2.3) * Math.sin(time * 0.7 + 1);

  audio.setFreqs(state.base, freqB());
  audio.setSolo(holdingBase);
  if (holdingBase) audio.hold(0);
  playBtn.classList.toggle('wait', state.playing && !audio.ready);

  stage.render(dt);
  if (!state.zen && state.axisLabels) placeAxisLabels();
  requestAnimationFrame(frame);
}

/* ---------- Start ---------- */

const savedTheme = THEMES.find((t) => t.id === store.get('theme')) ?? THEMES[0];
applyTheme(savedTheme, true);
const savedKlang = store.get('klang') as Klang | null;
applyKlang(KLAENGE.some((k) => k.id === savedKlang) ? savedKlang! : 'weich');
const savedVol = store.get('volume');
if (savedVol !== null && !Number.isNaN(+savedVol)) state.volume = Math.min(1, Math.max(0, +savedVol));
audio.setVolume(state.volume);
volumeSlider.value = String(Math.round(state.volume * 100));
setAllIntervals(store.get('allIntervals') === '1');
setAxisLabels(store.get('axisLabels') === '1');

baseSlider.value = String(Math.round((1000 * Math.log2(state.base / 110)) / 3));
tempoSlider.value = String(state.tempoV);
state.tempo = tempoFromSlider(state.tempoV);
tailSlider.value = String(Math.round((1000 * Math.log(state.tail / 0.3)) / Math.log(5 / 0.3)));
wobbleSlider.value = String(state.wobble * 100);
rSlider.value = String(sliderFromRatio(state.r));
off = state.phase;
stage.setDrawDecor(true);
updateTexts();
layout();
requestAnimationFrame(frame);

if (import.meta.env.DEV) (window as any).__lj = { stage, state };
