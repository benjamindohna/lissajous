/**
 * Klang: Dauerton (zwei Sinus) für den Form-Modus und Marimba-Anschläge
 * für den Zeichnen-Modus. Alles synthetisch, keine Sounddateien.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private oscA!: OscillatorNode;
  private oscB!: OscillatorNode;
  private gainB!: GainNode;
  private drone!: GainNode;
  private droneOn = false;
  private soloA = false;
  private fa = 220;
  private fb = 330;

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
    this.master.gain.value = 0.9;
    this.master.connect(comp);

    // kleiner Raum für die Anschläge
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    this.master.connect(verb);
    verb.connect(wet);
    wet.connect(comp);

    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    this.drone.connect(this.master);

    const voice = (freq: number, pan: number) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.2;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      osc.connect(g).connect(p).connect(this.drone);
      osc.start();
      return { osc, g };
    };
    this.oscA = voice(this.fa, -0.25).osc;
    const vb = voice(this.fb, 0.25);
    this.oscB = vb.osc;
    this.gainB = vb.g;
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

  setFreqs(fa: number, fb: number) {
    this.fa = fa;
    this.fb = Math.min(fb, 12000);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.oscA.frequency.setTargetAtTime(this.fa, t, 0.015);
    this.oscB.frequency.setTargetAtTime(this.fb, t, 0.015);
  }

  /** Dauerton an/aus; soloA = nur Grundton (beim Halten des Sliders). */
  setDrone(on: boolean, soloA: boolean) {
    if (!this.ctx) return;
    if (on === this.droneOn && soloA === this.soloA) return;
    const t = this.ctx.currentTime;
    this.drone.gain.cancelScheduledValues(t);
    this.drone.gain.setTargetAtTime(on ? 0.9 : 0, t, on ? 0.04 : 0.12);
    this.gainB.gain.cancelScheduledValues(t);
    this.gainB.gain.setTargetAtTime(soloA ? 0 : 0.2, t, 0.05);
    this.droneOn = on;
    this.soloA = soloA;
  }

  /** Kurzer Holzschlag, Marimba-artig. */
  hit(freq: number, pan: number, velocity = 1) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.005;
    const f = Math.min(freq, 6000);
    const decay = Math.max(0.18, Math.min(0.9, 90 / f));

    const out = ctx.createGain();
    out.gain.value = 0.55 * velocity;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    out.connect(p).connect(this.master);

    const partial = (mult: number, level: number, dec: number) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dec + 0.05);
    };
    partial(1, 0.7, decay);
    partial(3.93, 0.22, decay * 0.22);
    partial(9.2, 0.05, decay * 0.08);

    // Schlägel-Klick
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
    ng.gain.value = 0.12;
    n.connect(bp).connect(ng).connect(out);
    n.start(t);
  }
}
