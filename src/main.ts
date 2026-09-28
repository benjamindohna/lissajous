import './style.css';
import { Stage, AXIS, MAX_POINTS } from './stage';
import { SpringCurve, pts, cols, PALETTE, paletteIndex, intensity, wobble, hash, setPalette, stepPalette, TAU } from './figure';
import { AudioEngine, KLAENGE, type Klang } from './audio';
import { PRESETS, MAX_TERM, reduce, intervalName, formatNote, approximate, cents } from './ratio';
import { THEMES, hexToRgb, type Theme } from './themes';

type Mode = 'form' | 'draw';
type Trail = 'tail' | 'keep';

const state = {
  r: 1.5, // Frequenzverhältnis B/A (Ziel)
  exact: [2, 3] as [number, number] | null, // gesetzt = sauberes Verhältnis (Button, Einrasten, Eingabe)
  phase: 0,
  base: 220,
  mode: 'form' as Mode,
  playing: true,
  snap: true,
  wobble: 0.4,
  tempo: 0.4, // Hz, sichtbare Schwingung von Ton A im Zeichnen-Modus
  tempoV: 250, // Reglerstellung, damit „Echtzeit" beim Grundtonwechsel mitwandert
  trail: 'tail' as Trail,
  tail: 1.5, // Sekunden
  zen: false,
  theme: 'aurora',
  klang: 'holz' as Klang,
  volume: 0.8,
  fast: 'pur' as 'pur' | 'mix', // hohes Tempo: nur Anschläge oder Übergang in Dauerton
};

// Figur: a× A gegen b× B, delta = Rest bei freien Verhältnissen
let fig = { a: 2, b: 3, delta: 0 };

const SNAP_CENTS = 35; // Fangbereich beim Loslassen
const NEAR_CENTS = 45; // bis hier „fast Quinte"
const DRIFT_HZ = 8; // Drehgeschwindigkeit freier Verhältnisse im Form-Modus
const TEMPO_MIN = 0.08;
const DISSOLVE_S = 0.9; // radioaktives Verschwinden/Erscheinen
const BRAKE_TAU = 0.22; // sanftes Bremsen beim Pausieren
const HIT_FADE: [number, number] = [4, 14]; // Hz: Achsenmarkierungen hören auf zu blitzen
// Anschläge werden von 4 Hz bis Echtzeit gleichmäßig (logarithmisch) leiser, bis −26 dB,
// der Dauerton blendet über einen weiten Bereich ein – beide überlappen lange
const HIT_FROM = 4;
const HIT_FLOOR_DB = -26;
const DRONE_FADE: [number, number] = [5, 90];
const HIT_MAX_RATE = 30; // Anschläge pro Sekunde und Achse, darüber wird ausgedünnt

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (v: number, d = 1) => v.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtFixed = (v: number, d: number) => v.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Regler-Abbildungen (logarithmisch, wo es sich musikalisch/zeitlich so anfühlt)
const baseFromSlider = (v: number) => 110 * Math.pow(2, (3 * v) / 1000);
const tempoFromSlider = (v: number) => (v >= 995 ? state.base : TEMPO_MIN * Math.pow(state.base / TEMPO_MIN, v / 1000));
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
const spring = new SpringCurve();
const audio = new AudioEngine();

// Wiedergabe
let speed = 1; // 0..1, gebremst beim Pausieren
let presence = 1; // Form-Modus: 0 = verschwunden, 1 = da
let dissolveSeed = 0;
let frameNo = 0;

// Zeichnen-Modus: zwei durchlaufende Phasen, B = rNow·A + off
let thA = 0;
let off = 0;
let thStart = 0; // Beginn der aktuellen Zeichnung
let lastThB = 0;
let rNow = state.r; // gleitet zum Ziel state.r

// Form-Modus: aufgelaufene Drift freier Verhältnisse
let psi = 0;
let flashX = 0;
let lastHitA = 0;
let lastHitB = 0;
let schedA = 0; // bis hierhin sind Anschläge im Audio-Takt geplant
let schedB = 0;
let flashY = 0;
let holdingBase = false;
let time = 0;

const freqB = () => state.base * rNow;

function nearestPreset(r: number) {
  let best = PRESETS[0];
  let diff = Infinity;
  for (const p of PRESETS) {
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
  const { a, b } = fig;
  const near = nearestPreset(state.r);
  let name: string;
  if (state.exact) name = intervalName(state.exact[0], state.exact[1]) ?? 'Eigenes Verhältnis';
  else if (near.cents < NEAR_CENTS) name = `fast ${near.preset.name}`;
  else name = 'Freies Verhältnis';
  $('nowName').textContent = name;
  $('nowRatio').textContent = ratioLabel();

  let meta: string;
  if (state.exact) {
    const real = (a / state.base) * 1000;
    meta =
      state.mode === 'form' || state.tempoV >= 995
        ? `schließt sich nach ${a}× A und ${b}× B · in Echtzeit ${fmt(real, real < 10 ? 1 : 0)} ms`
        : `schließt sich nach ${a}× A und ${b}× B · hier ${fmt(a / state.tempo)} s`;
  } else {
    meta = `schließt sich nie ganz · dreht sich um ${a} : ${b}`;
  }
  $('nowMeta').textContent = meta;

  if (document.activeElement !== ratioInput) ratioInput.value = ratioLabel();
  labA.innerHTML = `<b>A</b>${fmt(state.base, 0)} Hz · ${formatNote(state.base)}`;
  const fb = state.base * state.r;
  labB.innerHTML = `<b>B</b>${fmt(fb, 0)} Hz · ${formatNote(fb)}`;
  $('baseVal').textContent = `${fmt(state.base, 0)} Hz · ${formatNote(state.base)}`;
  $('phaseVal').textContent = `${Math.round((state.phase / TAU) * 360)}°`;
  $('wobbleVal').textContent = state.wobble === 0 ? 'aus' : `${Math.round(state.wobble * 100)} %`;
  $('tempoVal').textContent =
    state.tempoV >= 995 ? 'Echtzeit' : `${fmt(state.tempo, state.tempo < 1 ? 2 : state.tempo < 10 ? 1 : 0)} Hz`;
  $('tailVal').textContent = `${fmt(state.tail)} s`;
  $('volumeVal').textContent = state.volume === 0 ? 'stumm' : `${Math.round(state.volume * 100)} %`;

  // Buttons und Reglerpunkte markieren
  const ex = state.exact;
  document.querySelectorAll<HTMLElement>('[data-a]').forEach((el) => {
    const pa = +el.dataset.a!;
    const pb = +el.dataset.b!;
    const on = !!ex && ex[0] === pa && ex[1] === pb;
    if (on && !el.classList.contains('on') && el.classList.contains('chip')) {
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

function refreshTargets() {
  spring.setTarget(fig.a, fig.b, state.phase + psi);
}

/** Pausierte Form kommt zurück, sobald man am Verhältnis dreht */
function wakeForm() {
  if (!state.playing && state.mode === 'form') setPlaying(true);
}

/** sauberes Verhältnis a:b (Button, Einrasten, Eingabe) – Figur schnappt federnd um */
function setExact(a: number, b: number, kick = 0.8) {
  const same = state.exact && state.exact[0] === a && state.exact[1] === b;
  if (same) return;
  state.exact = [a, b];
  state.r = b / a;
  fig = { a, b, delta: 0 };
  psi = 0;
  refreshTargets();
  spring.reseed();
  if (kick) spring.kick(kick);
  rSlider.value = String(sliderFromRatio(state.r));
  wakeForm();
  updateTexts();
}

/** freies Verhältnis vom Regler – Figur folgt weich, driftet wenn es sich nicht schließt */
function setFree(r: number) {
  state.exact = null;
  state.r = r;
  const next = approximate(r);
  if (next.a !== fig.a || next.b !== fig.b) {
    psi = 0;
    spring.reseed();
  }
  fig = next;
  refreshTargets();
  wakeForm();
  updateTexts();
}

function setMode(m: Mode) {
  state.mode = m;
  document.body.classList.toggle('mode-draw', m === 'draw');
  document.querySelectorAll<HTMLButtonElement>('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('restartBtn').hidden = m !== 'draw';
  stage.setDrawDecor(m === 'draw');
  thStart = thA;
  lastThB = rNow * thA + off;
  updateTexts();
  requestAnimationFrame(layout);
}

const playBtn = $('playBtn');
function setPlaying(on: boolean) {
  if (on === state.playing) return;
  state.playing = on;
  playBtn.classList.toggle('on', on);
  dissolveSeed = Math.random() * 1000;
  if (!on) audio.release();
  else if (state.mode === 'form') spring.kick(0.5);
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

document.querySelectorAll<HTMLButtonElement>('#modeSeg button').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.mode as Mode)),
);

playBtn.addEventListener('click', () => {
  // der erste Tipp startet nur den Ton, statt gleich zu pausieren
  if (!audioWasReady && state.playing) return;
  setPlaying(!state.playing);
});

// Intervall-Buttons (in Reglerreihenfolge tief → hoch) und Punkte auf dem Regler
const presetsEl = $('presets');
const marksEl = $('marks');
const byPitch = [...PRESETS].sort((p, q) => p.b / p.a - q.b / q.a);
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

// Verhältnis-Regler: frei ziehen, beim Loslassen einrasten
rSlider.addEventListener('input', () => setFree(ratioFromSlider(+rSlider.value)));
rSlider.addEventListener('change', () => {
  if (!state.snap || state.exact) return;
  const near = nearestPreset(state.r);
  if (near.cents <= SNAP_CENTS) setExact(near.preset.a, near.preset.b, 0.3);
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
    spring.kick(0.5);
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
  holdingBase = false;
};
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
baseSlider.addEventListener('input', () => {
  state.base = baseFromSlider(+baseSlider.value);
  state.tempo = tempoFromSlider(state.tempoV); // „Echtzeit" hängt am Grundton
  updateTexts();
});

const phaseSlider = $<HTMLInputElement>('phase');
phaseSlider.addEventListener('input', () => {
  const next = (+phaseSlider.value / 360) * TAU;
  off += next - state.phase;
  state.phase = next;
  refreshTargets();
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

document.querySelectorAll<HTMLButtonElement>('#fastSeg button').forEach((b) =>
  b.addEventListener('click', () => {
    state.fast = b.dataset.fast as 'pur' | 'mix';
    document.querySelectorAll<HTMLButtonElement>('#fastSeg button').forEach((x) => x.classList.toggle('on', x === b));
    store.set('fast', state.fast);
  }),
);
if (store.get('fast') === 'mix') (document.querySelector('#fastSeg [data-fast=mix]') as HTMLButtonElement).click();

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
  } else if (k === 'm') setMode(state.mode === 'form' ? 'draw' : 'form');
  else if (k === ' ') {
    e.preventDefault();
    setPlaying(!state.playing);
  } else if (/^[1-9]$/.test(k)) {
    const p = byPitch[+k - 1];
    if (p) setExact(p.a, p.b);
  }
});

new ResizeObserver(layout).observe(panel);
window.addEventListener('resize', layout);

/* ---------- Anschläge im Audio-Takt ---------- */

const LOOKAHEAD = 0.12;

/**
 * Nur-Anschläge-Modus: Nulldurchgänge für die nächsten ~120 ms vorausberechnen
 * und sample-genau planen. So bleibt jeder Schlag gleich lang, auch bei
 * hunderten pro Sekunde – nur das Tempo ändert sich.
 */
function scheduleHits(tempoEff: number, thB: number) {
  if (!audio.ready) return;
  const tNow = audio.now;
  const horizon = tNow + LOOKAHEAD;
  const wA = TAU * tempoEff;
  const axes: [0 | 1, number, number, number][] = [
    [0, thA, wA, state.base],
    [1, thB, wA * rNow, freqB()],
  ];
  for (const [axis, th, w, freq] of axes) {
    let from = axis === 0 ? schedA : schedB;
    if (from < tNow) from = tNow;
    if (w > 1e-4) {
      // Überlagerung vieler gleich langer Anschläge ausgleichen
      const overlap = (w / Math.PI) * audio.hitDuration(freq);
      audio.setAxisGain(axis, (axis === 0 ? 1 : 0.9) / Math.pow(1 + overlap * 0.35, 0.9));
      let k = Math.floor((th + w * (from - tNow)) / Math.PI) + 1;
      for (let guard = 0; guard < 600; guard++, k++) {
        const t = tNow + (k * Math.PI - th) / w;
        if (t > horizon) break;
        if (t >= from) audio.schedule(axis, freq, t);
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
  const presTarget = state.playing ? 1 : 0;
  presence += Math.sign(presTarget - presence) * Math.min(Math.abs(presTarget - presence), dt / DISSOLVE_S);

  // Verhältnis gleitet; die Phase von B wird so nachgeführt, dass der Punkt nicht springt
  const rTarget = state.r;
  const rNext = rNow * Math.pow(rTarget / rNow, 1 - Math.exp(-dt / 0.09));
  const rNew = Math.abs(rNext - rTarget) < 1e-7 ? rTarget : rNext;
  off -= (rNew - rNow) * thA;
  rNow = rNew;

  const { a, b } = fig;
  const phase = state.phase;
  const amp = state.wobble * 0.035;
  const I = intensity(a, b);
  let droneLevel = 0;
  let bloomBoost = 0;

  if (state.mode === 'form') {
    // freies Verhältnis: geschlossene Nachbarfigur, deren Phase langsam wandert
    if (fig.delta !== 0) {
      psi += TAU * DRIFT_HZ * (fig.delta / a) * dt;
      refreshTargets();
    }
    spring.step(dt);
    droneLevel = state.playing ? 1 : 0;

    const n = spring.n;
    if (presence <= 0) {
      stage.curve.set(pts, cols, 0);
    } else {
      const P = spring.pos;
      const shimmer = 0.22 * state.wobble;
      // radioaktiv: Stücke flackern, zucken und zerfallen zu unterschiedlichen Zeiten
      const pe = presence * presence * (3 - 2 * presence);
      const d = 1 - pe;
      const decaying = d > 0.001;
      const grow = 1 + 0.18 * d * d;
      const flash = 1 + 2.2 * d * pe;
      bloomBoost = 0.9 * d * pe;
      for (let i = 0; i < n; i++) {
        wobble(P[i * 2], P[i * 2 + 1], time, amp, w);
        let x = w.x;
        let y = w.y;
        let vis = 1;
        if (decaying) {
          const chunk = Math.floor(i / 26);
          const hc = hash(chunk + dissolveSeed);
          vis = smoothstep(hc * 0.6, hc * 0.6 + 0.4, pe) * (0.45 + 0.9 * hash(chunk * 7.3 + frameNo * 1.618));
          const j = 0.12 * d;
          x = x * grow + (hash(i * 1.7 + frameNo) - 0.5) * j;
          y = y * grow + (hash(i * 2.9 + frameNo + 50) - 0.5) * j;
        }
        pts[i * 3] = x;
        pts[i * 3 + 1] = y;
        pts[i * 3 + 2] = 0;
        const f = i / (n - 1);
        const ci = paletteIndex(f);
        const s = I * (1 + shimmer * Math.sin(f * TAU * 3 - time * 1.6)) * vis * flash;
        cols[i * 3] = PALETTE[ci] * s;
        cols[i * 3 + 1] = PALETTE[ci + 1] * s;
        cols[i * 3 + 2] = PALETTE[ci + 2] * s;
      }
      stage.curve.set(pts, cols, n);
    }
  } else {
    const tempoEff = state.tempo * speed;
    const omegaNom = TAU * state.tempo;
    const prevA = thA;
    thA += TAU * tempoEff * dt;

    // saubere Verhältnisse: Punkt gleitet auf die kanonische Spur (wie im Form-Modus)
    if (state.exact && rNow === rTarget) {
      const k = Math.round(((off - phase) * a) / TAU);
      const target = phase + (TAU * k) / a;
      off += (target - off) * (1 - Math.exp(-dt / 0.35));
    }
    const thB = rNow * thA + off;

    // Anschläge bei langsamem Tempo, Dauerton bei schnellem, mit langer Überlappung
    const x = Math.min(1, Math.max(0, Math.log(tempoEff / HIT_FROM) / Math.log(state.base / HIT_FROM)));
    const hitLevel = tempoEff <= HIT_FROM ? 1 : Math.pow(10, (HIT_FLOOR_DB * x) / 20);
    const flashLevel = 1 - smoothstep(HIT_FADE[0], HIT_FADE[1], tempoEff);
    const pure = state.fast === 'pur';
    droneLevel = pure ? 0 : smoothstep(Math.log(DRONE_FADE[0]), Math.log(DRONE_FADE[1]), Math.log(Math.max(tempoEff, 1e-3))) * speed;
    if (pure) {
      scheduleHits(tempoEff, thB);
      flashX = Math.max(flashX, Math.floor(thA / Math.PI) > Math.floor(prevA / Math.PI) ? flashLevel : 0);
      flashY = Math.max(flashY, Math.floor(thB / Math.PI) !== Math.floor(lastThB / Math.PI) ? flashLevel : 0);
    } else if (Math.floor(thA / Math.PI) > Math.floor(prevA / Math.PI)) {
      flashX = Math.max(flashX, flashLevel);
      if (time - lastHitA >= 1 / HIT_MAX_RATE) {
        lastHitA = time;
        audio.hit(state.base, -0.35, hitLevel);
      }
    }
    if (!pure && Math.floor(thB / Math.PI) !== Math.floor(lastThB / Math.PI)) {
      flashY = Math.max(flashY, flashLevel);
      if (time - lastHitB >= 1 / HIT_MAX_RATE) {
        lastHitB = time;
        audio.hit(freqB(), 0.35, 0.9 * hitLevel);
      }
    }
    lastThB = thB;

    // Spur analytisch aus der aktuellen Bewegung – ändert sich live beim Ziehen
    const keep = state.trail === 'keep';
    const full = TAU * a;
    const span0 = keep ? full : Math.min(full, omegaNom * state.tail);
    const u0 = Math.max(thStart, thA - span0);
    const span = thA - u0;
    const n = Math.max(2, Math.min(MAX_POINTS, Math.ceil(((Math.max(1, rNow) * span) / TAU) * 80) + 2));
    const Id = I * 1.25;
    const hv = 1 - smoothstep(3, 12, tempoEff); // bei Echtzeit: gleichmäßig wie die Form
    for (let i = 0; i < n; i++) {
      const u = u0 + (span * i) / (n - 1);
      wobble(Math.sin(u), Math.sin(rNow * u + off), time, amp, w);
      pts[i * 3] = w.x;
      pts[i * 3 + 1] = w.y;
      pts[i * 3 + 2] = 0;
      const age = (thA - u) / omegaNom;
      let s: number;
      if (keep) s = Id * 0.5 + Id * 1.1 * Math.exp(-age / 0.45) + 1.1 * Math.exp(-age / 0.08);
      else s = Id * Math.pow(Math.max(0, 1 - age / state.tail), 1.6) + 1.1 * Math.exp(-age / 0.08);
      s = hv * s + (1 - hv) * I;
      const ci = paletteIndex(u / full);
      cols[i * 3] = PALETTE[ci] * s;
      cols[i * 3 + 1] = PALETTE[ci + 1] * s;
      cols[i * 3 + 2] = PALETTE[ci + 2] * s;
    }
    stage.curve.set(pts, cols, n);
    const h = (n - 1) * 3;
    stage.setHead(pts[h], pts[h + 1], 1 + 0.07 * Math.sin(time * 7));
    stage.setHeadVisibility(hv);
  }

  const decay = Math.exp(-dt * 5);
  flashX *= decay;
  flashY *= decay;
  stage.setTicks(flashX, flashY);
  stage.bloom.strength = 0.75 + bloomBoost + state.wobble * 0.18 * Math.sin(time * 2.3) * Math.sin(time * 0.7 + 1);

  audio.setFreqs(state.base, freqB());
  if (holdingBase) audio.setDrone(1, true);
  else if (state.playing || droneLevel === 0) audio.setDrone(droneLevel, false);
  playBtn.classList.toggle('wait', state.playing && !audio.ready);

  stage.render(dt);
  if (!state.zen) placeAxisLabels();
  requestAnimationFrame(frame);
}

/* ---------- Start ---------- */

const savedTheme = THEMES.find((t) => t.id === store.get('theme')) ?? THEMES[0];
applyTheme(savedTheme, true);
const savedKlang = store.get('klang') as Klang | null;
applyKlang(KLAENGE.some((k) => k.id === savedKlang) ? savedKlang! : 'holz');
const savedVol = store.get('volume');
if (savedVol !== null && !Number.isNaN(+savedVol)) state.volume = Math.min(1, Math.max(0, +savedVol));
audio.setVolume(state.volume);
volumeSlider.value = String(Math.round(state.volume * 100));

baseSlider.value = String(Math.round((1000 * Math.log2(state.base / 110)) / 3));
tempoSlider.value = String(state.tempoV);
state.tempo = tempoFromSlider(state.tempoV);
tailSlider.value = String(Math.round((1000 * Math.log(state.tail / 0.3)) / Math.log(5 / 0.3)));
wobbleSlider.value = String(state.wobble * 100);
rSlider.value = String(sliderFromRatio(state.r));
off = state.phase;
refreshTargets(); // Punkte starten im Ursprung und schnappen auf
setMode('form');
updateTexts();
layout();
requestAnimationFrame(frame);

if (import.meta.env.DEV) (window as any).__lj = { stage, state };
