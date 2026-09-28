import './style.css';
import { Stage, AXIS, MAX_POINTS } from './stage';
import { SpringCurve, pts, cols, PALETTE, paletteIndex, intensity, wobble, TAU } from './figure';
import { AudioEngine } from './audio';
import { PRESETS, MAX_TERM, reduce, intervalName, formatNote, approximate, cents } from './ratio';

type Mode = 'form' | 'draw';
type Trail = 'tail' | 'keep';

const state = {
  r: 1.5, // Frequenzverhältnis B/A
  exact: [2, 3] as [number, number] | null, // gesetzt = sauberes Verhältnis (Button, Einrasten, Eingabe)
  phase: 0,
  base: 220,
  mode: 'form' as Mode,
  sound: true,
  snap: true,
  wobble: 0.4,
  tempo: 0.4, // Hz, sichtbare Schwingung von Ton A im Zeichnen-Modus
  trail: 'tail' as Trail,
  tail: 1.5, // Sekunden
  zen: false,
  more: false,
};

// Figur, die gezeichnet wird: a× A gegen b× B, delta = Rest bei freien Verhältnissen
let fig = { a: 2, b: 3, delta: 0 };

const SNAP_CENTS = 12; // Fangbereich beim Loslassen
const NEAR_CENTS = 30; // ab hier „fast Quinte"
const DRIFT_HZ = 8; // Drehgeschwindigkeit freier Verhältnisse im Form-Modus

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (v: number, d = 1) => v.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtFixed = (v: number, d: number) => v.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });

// Regler-Abbildungen (logarithmisch, wo es sich musikalisch/zeitlich so anfühlt)
const baseFromSlider = (v: number) => 110 * Math.pow(2, (3 * v) / 1000);
const tempoFromSlider = (v: number) => 0.1 * Math.pow(30, v / 1000);
const tailFromSlider = (v: number) => 0.3 * Math.pow(5 / 0.3, v / 1000);
const ratioFromSlider = (v: number) => Math.pow(2, v / 10000);
const sliderFromRatio = (r: number) => Math.round(Math.min(1, Math.max(0, Math.log2(r))) * 10000);

const canvas = $<HTMLCanvasElement>('c');
const stage = new Stage(canvas);
const spring = new SpringCurve();
const audio = new AudioEngine();

let uHead = 0; // Zeichnen-Modus: Phase von Ton A
let psi = 0; // Form-Modus: aufgelaufene Drift freier Verhältnisse
let flashX = 0;
let flashY = 0;
let holdingBase = false;
let time = 0;

const freqB = () => state.base * state.r;

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
      state.mode === 'form'
        ? `schließt sich nach ${a}× A und ${b}× B · in Echtzeit ${fmt(real, real < 10 ? 1 : 0)} ms`
        : `schließt sich nach ${a}× A und ${b}× B · hier ${fmt(a / state.tempo)} s`;
  } else {
    meta = `schließt sich nie ganz · dreht sich um ${a} : ${b}`;
  }
  $('nowMeta').textContent = meta;

  if (document.activeElement !== ratioInput) ratioInput.value = ratioLabel();
  labA.innerHTML = `<b>A</b>${fmt(state.base, 0)} Hz · ${formatNote(state.base)}`;
  labB.innerHTML = `<b>B</b>${fmt(freqB(), 0)} Hz · ${formatNote(freqB())}`;
  $('baseVal').textContent = `${fmt(state.base, 0)} Hz · ${formatNote(state.base)}`;
  $('phaseVal').textContent = `${Math.round((state.phase / TAU) * 360)}°`;
  $('wobbleVal').textContent = state.wobble === 0 ? 'aus' : `${Math.round(state.wobble * 100)} %`;
  $('tempoVal').textContent = `${fmt(state.tempo, 2)} Hz`;
  $('tailVal').textContent = `${fmt(state.tail)} s`;

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
  uHead = 0;
  rSlider.value = String(sliderFromRatio(state.r));
  audio.setFreqs(state.base, freqB());
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
  audio.setFreqs(state.base, freqB());
  updateTexts();
}

function setMode(m: Mode) {
  state.mode = m;
  document.body.classList.toggle('mode-draw', m === 'draw');
  document.querySelectorAll<HTMLButtonElement>('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('restartBtn').hidden = m !== 'draw';
  stage.setDrawDecor(m === 'draw');
  uHead = 0;
  updateTexts();
  requestAnimationFrame(layout);
}

let hintTimer = 0;
function setZen(on: boolean) {
  state.zen = on;
  document.body.classList.toggle('zen', on);
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
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });

document.querySelectorAll<HTMLButtonElement>('#modeSeg button').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.mode as Mode)),
);
document.querySelectorAll<HTMLButtonElement>('#trailSeg button').forEach((b) =>
  b.addEventListener('click', () => {
    state.trail = b.dataset.trail as Trail;
    document.body.classList.toggle('trail-keep', state.trail === 'keep');
    document.querySelectorAll<HTMLButtonElement>('#trailSeg button').forEach((x) => x.classList.toggle('on', x === b));
    uHead = 0;
    requestAnimationFrame(layout);
  }),
);

// Intervall-Buttons und Punkte auf dem Regler
const presetsEl = $('presets');
const marksEl = $('marks');
// Buttons in Reglerreihenfolge (tief → hoch), damit Punkte und Buttons zusammenpassen
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

// Verhältnis-Regler: frei ziehen, beim Loslassen fein einrasten
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

// Einstellungen
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
  audio.setFreqs(state.base, freqB());
  updateTexts();
});

const phaseSlider = $<HTMLInputElement>('phase');
phaseSlider.addEventListener('input', () => {
  state.phase = (+phaseSlider.value / 360) * TAU;
  refreshTargets();
  updateTexts();
});
const wobbleSlider = $<HTMLInputElement>('wobble');
wobbleSlider.addEventListener('input', () => {
  state.wobble = +wobbleSlider.value / 100;
  updateTexts();
});
const tempoSlider = $<HTMLInputElement>('tempo');
tempoSlider.addEventListener('input', () => {
  state.tempo = tempoFromSlider(+tempoSlider.value);
  updateTexts();
});
const tailSlider = $<HTMLInputElement>('tail');
tailSlider.addEventListener('input', () => {
  state.tail = tailFromSlider(+tailSlider.value);
  updateTexts();
});

const soundBtn = $('soundBtn');
soundBtn.addEventListener('click', () => {
  state.sound = !state.sound;
  soundBtn.classList.toggle('on', state.sound);
});
$('restartBtn').addEventListener('click', () => {
  uHead = 0;
});
const moreBtn = $('moreBtn');
moreBtn.addEventListener('click', () => {
  state.more = !state.more;
  $('more').hidden = !state.more;
  moreBtn.classList.toggle('on', state.more);
  requestAnimationFrame(layout);
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
  else if (k === 'escape' && state.zen) setZen(false);
  else if (k === 'm') setMode(state.mode === 'form' ? 'draw' : 'form');
  else if (k === 's') soundBtn.click();
  else if (/^[1-9]$/.test(k)) {
    const p = byPitch[+k - 1];
    if (p) setExact(p.a, p.b);
  }
});

new ResizeObserver(layout).observe(panel);
window.addEventListener('resize', layout);

/* ---------- Schleife ---------- */

const w = { x: 0, y: 0 };
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  const { a, b } = fig;
  const phase = state.phase;
  const amp = state.wobble * 0.035;
  const I = intensity(a, b);

  if (state.mode === 'form') {
    // freies Verhältnis: geschlossene Nachbarfigur, deren Phase langsam wandert
    if (fig.delta !== 0) {
      psi += TAU * DRIFT_HZ * (fig.delta / a) * dt;
      refreshTargets();
    }
    spring.step(dt);
    const n = spring.n;
    const P = spring.pos;
    const shimmer = 0.22 * state.wobble;
    for (let i = 0; i < n; i++) {
      wobble(P[i * 2], P[i * 2 + 1], time, amp, w);
      pts[i * 3] = w.x;
      pts[i * 3 + 1] = w.y;
      pts[i * 3 + 2] = 0;
      const f = i / (n - 1);
      const ci = paletteIndex(f);
      const s = I * (1 + shimmer * Math.sin(f * TAU * 3 - time * 1.6));
      cols[i * 3] = PALETTE[ci] * s;
      cols[i * 3 + 1] = PALETTE[ci + 1] * s;
      cols[i * 3 + 2] = PALETTE[ci + 2] * s;
    }
    stage.curve.set(pts, cols, n);
  } else {
    // u = Phase von Ton A; B läuft mit dem echten Verhältnis r
    const r = state.r;
    const omega = TAU * state.tempo;
    const prevU = uHead;
    uHead += omega * dt;

    // Anschläge: Nulldurchgang jeder Achse = Punkt kreuzt die Mittelmarkierung
    const hx = Math.floor(uHead / Math.PI) - Math.floor(prevU / Math.PI);
    const hy = Math.floor((r * uHead + phase) / Math.PI) - Math.floor((r * prevU + phase) / Math.PI);
    if (hx > 0) {
      flashX = 1;
      if (state.sound) audio.hit(state.base, -0.35);
    }
    if (hy > 0) {
      flashY = 1;
      if (state.sound) audio.hit(freqB(), 0.35, 0.9);
    }

    const keep = state.trail === 'keep';
    const u0 = keep ? Math.max(0, uHead - TAU * a) : Math.max(0, uHead - omega * state.tail);
    const span = uHead - u0;
    const n = Math.max(2, Math.min(MAX_POINTS, Math.ceil(((Math.max(1, r) * span) / TAU) * 80) + 2));
    const Id = I * 1.25;
    for (let i = 0; i < n; i++) {
      const u = u0 + (span * i) / (n - 1);
      wobble(Math.sin(u), Math.sin(r * u + phase), time, amp, w);
      pts[i * 3] = w.x;
      pts[i * 3 + 1] = w.y;
      pts[i * 3 + 2] = 0;
      const age = (uHead - u) / omega;
      let s: number;
      if (keep) s = Id * 0.5 + Id * 1.1 * Math.exp(-age / 0.45) + 1.1 * Math.exp(-age / 0.08);
      else s = Id * Math.pow(Math.max(0, 1 - age / state.tail), 1.6) + 1.1 * Math.exp(-age / 0.08);
      const ci = paletteIndex(u / (TAU * a));
      cols[i * 3] = PALETTE[ci] * s;
      cols[i * 3 + 1] = PALETTE[ci + 1] * s;
      cols[i * 3 + 2] = PALETTE[ci + 2] * s;
    }
    stage.curve.set(pts, cols, n);
    const h = (n - 1) * 3;
    stage.setHead(pts[h], pts[h + 1], 1 + 0.07 * Math.sin(time * 7));
  }

  const decay = Math.exp(-dt * 5);
  flashX *= decay;
  flashY *= decay;
  stage.setTicks(flashX, flashY);
  stage.bloom.strength = 0.75 + state.wobble * 0.18 * Math.sin(time * 2.3) * Math.sin(time * 0.7 + 1);

  audio.setDrone(holdingBase || (state.mode === 'form' && state.sound), holdingBase);
  soundBtn.classList.toggle('wait', state.sound && !audio.ready);

  stage.render(dt);
  if (!state.zen) placeAxisLabels();
  requestAnimationFrame(frame);
}

/* ---------- Start ---------- */

baseSlider.value = String(Math.round((1000 * Math.log2(state.base / 110)) / 3));
tempoSlider.value = String(Math.round((1000 * Math.log(state.tempo / 0.1)) / Math.log(30)));
tailSlider.value = String(Math.round((1000 * Math.log(state.tail / 0.3)) / Math.log(5 / 0.3)));
wobbleSlider.value = String(state.wobble * 100);
rSlider.value = String(sliderFromRatio(state.r));
refreshTargets(); // Punkte starten im Ursprung und schnappen auf
audio.setFreqs(state.base, freqB());
setMode('form');
updateTexts();
layout();
requestAnimationFrame(frame);

if (import.meta.env.DEV) (window as any).__lj = { stage, state };
