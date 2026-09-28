/**
 * Klang: pro Ton eine durchgehend schwingende Stimme (wie eine Saite).
 * Ein Anschlag regt sie nur neu an. Langsam angeschlagen klingt sie zwischen
 * den Schlägen aus; je dichter die Schläge, desto länger klingt sie nach, bis
 * sie nie mehr leiser wird – dann ist es ein gehaltener Ton mit demselben Klang.
 * Beim Pausieren fängt ein kurzes Echo das Ausklingen auf.
 */
export type Klang = 'weich' | 'holz' | 'orgel';

export const KLAENGE: { id: Klang; name: string }[] = [
  { id: 'weich', name: 'Weich' },
  { id: 'holz', name: 'Holz' },
  { id: 'orgel', name: 'Orgel' },
];

interface Partial {
  mult: number; // Frequenzfaktor
  level: number;
  rel: number; // Abklingzeit relativ zur Grunddauer
  harmonic: boolean; // unharmonische Teiltöne verschwinden im gehaltenen Ton
}

interface Spec {
  partials: Partial[];
  dur: (f: number) => number; // Abklingen bis −80 dB bei einem einzelnen Schlag
  attack: number;
  click: number;
}

const p = (mult: number, level: number, rel: number, harmonic = true): Partial => ({ mult, level, rel, harmonic });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const SPECS: Record<Klang, Spec> = {
  weich: { partials: [p(1, 0.75, 1), p(2, 0.12, 0.5), p(3, 0.05, 0.3)], dur: (f) => clamp(160 / f, 0.35, 1.1), attack: 0.014, click: 0 },
  holz: { partials: [p(1, 0.7, 1), p(3.93, 0.22, 0.22, false), p(9.2, 0.05, 0.08, false)], dur: (f) => clamp(90 / f, 0.18, 0.9), attack: 0.003, click: 0.12 },
  orgel: { partials: [p(1, 0.5, 1), p(2, 0.28, 1), p(3, 0.18, 0.9), p(4, 0.1, 0.8)], dur: () => 0.32, attack: 0.008, click: 0 },
};

// Übergang Einzelschläge → gehaltener Ton, gemessen am Tempo von Ton A (Hz, logarithmisch).
// Beide Töne gehen gemeinsam über, damit es an derselben Reglerstelle passiert.
const SUSTAIN_FROM = 17;
const SUSTAIN_TO = 24;

/** 0 = einzelne Schläge, 1 = gehaltener Ton */
export function sustainAmount(tempo: number) {
  if (tempo <= SUSTAIN_FROM) return 0;
  const t = clamp(Math.log(tempo / SUSTAIN_FROM) / Math.log(SUSTAIN_TO / SUSTAIN_FROM), 0, 1);
  return t * t * (3 - 2 * t);
}

const LEVEL_STRIKE = 0.5;
const LEVEL_HOLD = 0.44;

class Voice {
  private oscs: OscillatorNode[] = [];
  private envs: GainNode[] = [];
  readonly out: GainNode;
  private freq = 220;
  private spec: Spec = SPECS.weich;
  held = false;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    pan: number,
  ) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    this.out = ctx.createGain();
    this.out.connect(panner).connect(dest);
  }

  setSpec(spec: Spec) {
    const t = this.ctx.currentTime;
    for (const o of this.oscs) o.stop(t + 0.05);
    for (const e of this.envs) e.gain.setTargetAtTime(0, t, 0.01);
    this.spec = spec;
    this.oscs = [];
    this.envs = [];
    for (const part of spec.partials) {
      const o = this.ctx.createOscillator();
      o.frequency.value = Math.min(this.freq * part.mult, 18000);
      const e = this.ctx.createGain();
      e.gain.value = 0;
      o.connect(e).connect(this.out);
      o.start();
      this.oscs.push(o);
      this.envs.push(e);
    }
    this.held = false;
  }

  setFreq(f: number) {
    this.freq = f;
    const t = this.ctx.currentTime;
    this.spec.partials.forEach((part, i) => this.oscs[i].frequency.setTargetAtTime(Math.min(f * part.mult, 18000), t, 0.015));
  }

  private peak(part: Partial, s: number) {
    const level = LEVEL_STRIKE + (LEVEL_HOLD - LEVEL_STRIKE) * s;
    return part.level * level * (part.harmonic ? 1 : 1 - s);
  }

  /** Anschlag zur Zeit t; rate = Schläge pro Sekunde dieser Stimme, s = sustainAmount */
  strike(t: number, rate: number, s: number) {
    const gap = 1 / Math.max(rate, 1e-3);
    const { spec } = this;
    if (this.held) {
      for (const e of this.envs) e.gain.cancelScheduledValues(t);
      this.held = false;
    }
    const base = spec.dur(this.freq);
    spec.partials.forEach((part, i) => {
      const natural = (base * part.rel) / 9.2; // Zeitkonstante für −80 dB nach „dur"
      const tau = Math.max(natural, gap * 25 * s * s);
      const g = this.envs[i].gain;
      g.setTargetAtTime(this.peak(part, s), t, spec.attack / 3);
      g.setTargetAtTime(0, t + spec.attack, tau);
    });
    if (spec.click > 0 && s < 0.5) this.click(t, spec.click * (1 - 2 * s));
  }

  /** gehaltener Ton (Form-Modus, sehr schnelles Tempo) */
  hold() {
    if (this.held) return;
    const t = this.ctx.currentTime;
    this.spec.partials.forEach((part, i) => {
      const g = this.envs[i].gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(this.peak(part, 1), t, 0.04);
    });
    this.held = true;
  }

  /** ausklingen lassen */
  release(tau = 0.14) {
    const t = this.ctx.currentTime;
    for (const e of this.envs) {
      e.gain.cancelScheduledValues(t);
      e.gain.setTargetAtTime(0, t, tau);
    }
    this.held = false;
  }

  private click(t: number, level: number) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 0.012);
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const n = ctx.createBufferSource();
    n.buffer = nb;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(this.freq * 2.5, 8000);
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.value = level * 0.55;
    n.connect(bp).connect(ng).connect(this.out);
    n.start(t);
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private echoSend!: GainNode;
  private voices: Voice[] = [];
  private fa = 220;
  private fb = 330;
  private klang: Klang = 'weich';
  private volume = 0.8;
  private solo = false;

  /** Muss aus einer Nutzergeste heraus aufgerufen werden (iOS). */
  unlock() {
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private build() {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);

    // kleiner Raum
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    this.master.connect(verb);
    verb.connect(wet);
    wet.connect(comp);

    // Echo nur fürs Ausklingen beim Pausieren: Send ist normalerweise zu
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.23;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0;
    this.echoSend.connect(delay);
    delay.connect(lp).connect(fb).connect(delay);
    lp.connect(this.master);

    const bus = ctx.createGain();
    bus.connect(this.master);
    bus.connect(this.echoSend);
    this.voices = [new Voice(ctx, bus, -0.3), new Voice(ctx, bus, 0.3)];
    for (const v of this.voices) v.setSpec(SPECS[this.klang]);
    this.voices[0].setFreq(this.fa);
    this.voices[1].setFreq(this.fb);
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  setKlang(k: Klang) {
    this.klang = k;
    for (const v of this.voices) v.setSpec(SPECS[k]);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setFreqs(fa: number, fb: number) {
    if (Math.abs(fa - this.fa) < 1e-3 && Math.abs(fb - this.fb) < 1e-3) return;
    this.fa = fa;
    this.fb = Math.min(fb, 12000);
    if (!this.ctx) return;
    this.voices[0].setFreq(this.fa);
    this.voices[1].setFreq(this.fb);
  }

  /** nur Ton A hörbar (beim Halten des Grundton-Reglers) */
  setSolo(on: boolean) {
    if (!this.ctx || on === this.solo) return;
    this.solo = on;
    this.voices[1].out.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  hold(axis: 0 | 1) {
    if (this.ready) this.voices[axis].hold();
  }

  strike(axis: 0 | 1, when: number, rate: number, s: number) {
    if (!this.ready) return;
    this.voices[axis].strike(Math.max(when, this.ctx!.currentTime), rate, s);
  }

  /** Pause: sanft ausklingen lassen, mit kurzem Echo */
  release() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.voices) v.release(0.14);
    this.echoSend.gain.cancelScheduledValues(t);
    this.echoSend.gain.setValueAtTime(0.6, t);
    this.echoSend.gain.setTargetAtTime(0, t + 0.5, 0.15);
  }

  /** leise ohne Echo (Moduswechsel, Grundton losgelassen) */
  quiet(axis?: 0 | 1) {
    if (!this.ctx) return;
    this.voices.forEach((v, i) => (axis === undefined || axis === i) && v.release(0.08));
  }
}
