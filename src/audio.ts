/**
 * Klang: Dauerton (A + B) und kurze Anschläge für den Zeichnen-Modus.
 * Alles synthetisch. Beim Pausieren fängt ein kurzes Echo das Ausklingen auf.
 */
export type Klang = 'holz' | 'glas' | 'weich' | 'orgel';

export const KLAENGE: { id: Klang; name: string }[] = [
  { id: 'holz', name: 'Holz' },
  { id: 'glas', name: 'Glas' },
  { id: 'weich', name: 'Weich' },
  { id: 'orgel', name: 'Orgel' },
];

// Obertöne des Dauertons (Index = Harmonische)
const DRONE: Record<Klang, { harm: number[]; gain: number }> = {
  holz: { harm: [0, 1], gain: 0.2 },
  glas: { harm: [0, 1, 0.12, 0, 0.06], gain: 0.19 },
  weich: { harm: [0, 1, 0, 0.11, 0, 0.04], gain: 0.2 },
  orgel: { harm: [0, 1, 0.55, 0.35, 0.22, 0, 0.12, 0, 0.08], gain: 0.13 },
};

// Anschlag: [Frequenzfaktor, Pegel, Abklingzeit relativ zur Grunddauer]
const HIT: Record<Klang, { partials: [number, number, number][]; dur: (f: number) => number; attack: number; click: number }> = {
  holz: { partials: [[1, 0.7, 1], [3.93, 0.22, 0.22], [9.2, 0.05, 0.08]], dur: (f) => clamp(90 / f, 0.18, 0.9), attack: 0.003, click: 0.12 },
  glas: { partials: [[1, 0.55, 1], [2.76, 0.26, 0.6], [5.4, 0.12, 0.35], [8.93, 0.06, 0.2]], dur: () => 1.5, attack: 0.002, click: 0.03 },
  weich: { partials: [[1, 0.75, 1], [2, 0.12, 0.5], [3, 0.05, 0.3]], dur: (f) => clamp(160 / f, 0.35, 1.1), attack: 0.014, click: 0 },
  orgel: { partials: [[1, 0.5, 1], [2, 0.28, 1], [3, 0.18, 0.9], [4, 0.1, 0.8]], dur: () => 0.32, attack: 0.008, click: 0 },
};

const REF_HZ = 220;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private oscA!: OscillatorNode;
  private oscB!: OscillatorNode;
  private gainA!: GainNode;
  private gainB!: GainNode;
  private drone!: GainNode;
  private echoSend!: GainNode;
  private level = 0;
  private soloA = false;
  private fa = 220;
  private fb = 330;
  private klang: Klang = 'holz';
  private axisBus: GainNode[] = [];
  private hitBuf = new Map<Klang, AudioBuffer>();
  private volume = 0.8;

  /** Muss aus einer Nutzergeste heraus aufgerufen werden (iOS). */
  unlock() {
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
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

    // Echo nur fürs Ausklingen: Send ist normalerweise zu
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

    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    this.drone.connect(this.master);
    this.drone.connect(this.echoSend);

    const voice = (freq: number, pan: number) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      osc.connect(g).connect(p).connect(this.drone);
      osc.start();
      return { osc, g };
    };
    const va = voice(this.fa, -0.25);
    const vb = voice(this.fb, 0.25);
    this.oscA = va.osc;
    this.gainA = va.g;
    this.oscB = vb.osc;
    this.gainB = vb.g;

    for (const pan of [-0.35, 0.35]) {
      const g = ctx.createGain();
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.master);
      this.axisBus.push(g);
    }
    this.applyKlang();
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

  private wave(harm: number[]) {
    const real = new Float32Array(harm.length);
    const imag = Float32Array.from(harm);
    return this.ctx!.createPeriodicWave(real, imag);
  }

  private applyKlang() {
    if (!this.ctx) return;
    const d = DRONE[this.klang];
    const w = this.wave(d.harm);
    this.oscA.setPeriodicWave(w);
    this.oscB.setPeriodicWave(w);
    const t = this.ctx.currentTime;
    this.gainA.gain.setTargetAtTime(d.gain, t, 0.05);
    this.gainB.gain.setTargetAtTime(this.soloA ? 0 : d.gain, t, 0.05);
  }

  setKlang(k: Klang) {
    this.klang = k;
    this.applyKlang();
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
    const t = this.ctx.currentTime;
    this.oscA.frequency.setTargetAtTime(this.fa, t, 0.015);
    this.oscB.frequency.setTargetAtTime(this.fb, t, 0.015);
  }

  /** Dauerton-Pegel 0..1; soloA = nur Grundton (beim Halten des Grundton-Reglers). */
  setDrone(level: number, soloA: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (Math.abs(level - this.level) > 0.01 || (level === 0 && this.level !== 0)) {
      this.drone.gain.setTargetAtTime(level * 0.9, t, level > this.level ? 0.04 : 0.1);
      this.level = level;
    }
    if (soloA !== this.soloA) {
      this.soloA = soloA;
      this.gainB.gain.setTargetAtTime(soloA ? 0 : DRONE[this.klang].gain, t, 0.05);
    }
  }

  /** Pause: Dauerton sanft ausklingen lassen, mit kurzem Echo */
  release() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.drone.gain.cancelScheduledValues(t);
    this.drone.gain.setTargetAtTime(0, t, 0.14);
    this.level = 0;
    this.echoSend.gain.cancelScheduledValues(t);
    this.echoSend.gain.setValueAtTime(0.6, t);
    this.echoSend.gain.setTargetAtTime(0, t + 0.5, 0.15);
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Anschlag einmal bei REF_HZ vorrechnen; gespielt wird per playbackRate */
  private buffer(): AudioBuffer {
    const cached = this.hitBuf.get(this.klang);
    if (cached) return cached;
    const ctx = this.ctx!;
    const spec = HIT[this.klang];
    const f = REF_HZ;
    const dur = spec.dur(f);
    const len = Math.ceil(ctx.sampleRate * (spec.attack + dur + 0.02));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const sr = ctx.sampleRate;
    for (const [mult, level, rel] of spec.partials) {
      const w = (2 * Math.PI * f * mult) / sr;
      const tau = (dur * rel) / 9.2; // exponentialRamp auf 0,0001 ≈ e^−9,2
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = t < spec.attack ? t / spec.attack : Math.exp(-(t - spec.attack) / tau);
        d[i] += level * env * Math.sin(w * i);
      }
    }
    if (spec.click > 0) {
      const n = Math.floor(sr * 0.012);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        lp += 0.35 * ((Math.random() * 2 - 1) - lp);
        d[i] += spec.click * lp * (1 - i / n);
      }
    }
    for (let i = 0; i < len; i++) d[i] *= 0.55;
    this.hitBuf.set(this.klang, buf);
    return buf;
  }

  /** Länge eines Anschlags in Sekunden bei dieser Tonhöhe */
  hitDuration(freq: number) {
    return this.ready ? this.buffer().duration * (REF_HZ / freq) : 0.4;
  }

  /** sample-genau geplanter Anschlag (Achse 0 = A, 1 = B) */
  schedule(axis: 0 | 1, freq: number, when: number) {
    if (!this.ready) return;
    const src = this.ctx!.createBufferSource();
    src.buffer = this.buffer();
    src.playbackRate.value = Math.min(freq, 6000) / REF_HZ;
    src.connect(this.axisBus[axis]);
    src.start(Math.max(when, this.ctx!.currentTime));
  }

  /** Pegel je Achse, gleicht die Überlagerung vieler Anschläge aus */
  setAxisGain(axis: 0 | 1, g: number) {
    if (!this.ready) return;
    this.axisBus[axis].gain.setTargetAtTime(g, this.ctx!.currentTime, 0.05);
  }

  /** kurzer Anschlag in der Tonhöhe des jeweiligen Tons */
  hit(freq: number, pan: number, velocity = 1) {
    if (!this.ready || velocity <= 0.002) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.005;
    const f = Math.min(freq, 6000);
    const spec = HIT[this.klang];
    const dur = spec.dur(f);

    const out = ctx.createGain();
    out.gain.value = 0.55 * velocity;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    out.connect(p).connect(this.master);

    for (const [mult, level, rel] of spec.partials) {
      const pf = f * mult;
      if (pf > 16000) continue;
      const dec = dur * rel;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = pf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + spec.attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + spec.attack + dec);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + spec.attack + dec + 0.05);
    }

    if (spec.click > 0) {
      const len = Math.floor(ctx.sampleRate * 0.012);
      const nb = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const n = ctx.createBufferSource();
      n.buffer = nb;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(f * 2.5, 8000);
      bp.Q.value = 1.2;
      const ng = ctx.createGain();
      ng.gain.value = spec.click;
      n.connect(bp).connect(ng).connect(out);
      n.start(t);
    }
  }
}
