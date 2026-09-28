import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GlowLine } from './glowline';

/** Die Figur lebt in [-1, 1]². Die Achsen stehen als freies „L" daneben. */
export const PAD = 0.22;
export const AXIS = -1 - PAD;
const AXIS_LEN = 1.04;
const TICK = 0.055;

// sichtbarer Inhalt (Figur + Achsen + Luft)
const BOX = { minX: AXIS - 0.12, maxX: 1.08, minY: AXIS - 0.12, maxY: 1.08 };

export const MAX_POINTS = 8192;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;

  readonly curve = new GlowLine(MAX_POINTS, 2);
  readonly axisX = new GlowLine(2, 1.25);
  readonly axisY = new GlowLine(2, 1.25);
  readonly tickX = new GlowLine(2, 2);
  readonly tickY = new GlowLine(2, 2);
  readonly head: THREE.Sprite;
  readonly halo: THREE.Sprite;
  readonly dotX: THREE.Sprite;
  readonly dotY: THREE.Sprite;
  readonly guides: THREE.LineSegments;
  private guidePos: Float32Array;
  private lines: GlowLine[];

  width = 1;
  height = 1;
  ppu = 100;
  private camX = 0;
  private camY = 0;
  private targetX = 0;
  private targetY = 0;
  private firstLayout = true;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x05060a, 1);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.3, 0.08);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.lines = [this.curve, this.axisX, this.axisY, this.tickX, this.tickY];
    for (const l of this.lines) this.scene.add(l.obj);

    this.axisX.set([-AXIS_LEN, AXIS, 0, AXIS_LEN, AXIS, 0], null, 2);
    this.axisY.set([AXIS, -AXIS_LEN, 0, AXIS, AXIS_LEN, 0], null, 2);
    this.tickX.set([0, AXIS - TICK, 0, 0, AXIS + TICK, 0], null, 2);
    this.tickY.set([AXIS - TICK, 0, 0, AXIS + TICK, 0, 0], null, 2);
    this.axisX.mat.color.setRGB(0.1, 0.12, 0.18);
    this.axisY.mat.color.setRGB(0.1, 0.12, 0.18);

    const tex = glowTexture();
    const sprite = (color: THREE.ColorRepresentation, size: number, opacity = 1) => {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          color,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        }),
      );
      s.scale.setScalar(size);
      this.scene.add(s);
      return s;
    };
    this.halo = sprite(0x5fe3ff, 0.42, 0.35);
    this.head = sprite(0xffffff, 0.13);
    this.dotX = sprite(0x9fdfff, 0.09);
    this.dotY = sprite(0x9fdfff, 0.09);

    this.guidePos = new Float32Array(12);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(this.guidePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.guides = new THREE.LineSegments(
      gg,
      new THREE.LineBasicMaterial({ color: 0x6f8cff, transparent: true, opacity: 0.16, depthTest: false }),
    );
    this.guides.frustumCulled = false;
    this.scene.add(this.guides);
  }

  setDrawDecor(visible: boolean) {
    this.head.visible = this.halo.visible = visible;
    this.dotX.visible = this.dotY.visible = visible;
    this.guides.visible = visible;
  }

  setHead(x: number, y: number, pulse: number) {
    this.head.position.set(x, y, 0);
    this.halo.position.set(x, y, 0);
    this.head.scale.setScalar(0.13 * pulse);
    this.dotX.position.set(x, AXIS, 0);
    this.dotY.position.set(AXIS, y, 0);
    const g = this.guidePos;
    g.set([x, AXIS, 0, x, y, 0, AXIS, y, 0, x, y, 0]);
    (this.guides.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Intensität der Mittelmarkierungen (0 = ruhend, 1 = frisch angeschlagen) */
  setTicks(fx: number, fy: number) {
    const base = 0.35;
    this.tickX.mat.color.setRGB(base + fx * 2.2, base + fx * 2.6, base + fx * 3);
    this.tickY.mat.color.setRGB(base + fy * 2.2, base + fy * 2.6, base + fy * 3);
    this.dotX.material.opacity = 0.55 + fx * 0.8;
    this.dotY.material.opacity = 0.55 + fy * 0.8;
  }

  setAxesDim(dim: number) {
    const v = 0.1 * dim;
    this.axisX.mat.color.setRGB(v, v * 1.2, v * 1.8);
    this.axisY.mat.color.setRGB(v, v * 1.2, v * 1.8);
  }

  /** bottomInset/topInset: Pixel, die von UI verdeckt sind */
  layout(w: number, h: number, topInset: number, bottomInset: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloom.setSize(Math.round((w * dpr) / 2), Math.round((h * dpr) / 2));
    for (const l of this.lines) l.setResolution(w * dpr, h * dpr, dpr);
    this.curve.mat.linewidth = 2 * dpr;

    const availH = Math.max(120, h - topInset - bottomInset);
    const bw = BOX.maxX - BOX.minX;
    const bh = BOX.maxY - BOX.minY;
    this.ppu = Math.min((w * 0.88) / bw, (availH * 0.9) / bh);
    const cx = (BOX.minX + BOX.maxX) / 2;
    const cy = (BOX.minY + BOX.maxY) / 2;
    // Inhalt soll in der Mitte des freien Bereichs sitzen
    const shiftPx = (bottomInset - topInset) / 2;
    this.targetX = cx;
    this.targetY = cy - shiftPx / this.ppu;
    if (this.firstLayout) {
      this.camX = this.targetX;
      this.camY = this.targetY;
      this.firstLayout = false;
    }
    this.applyCamera();
  }

  private applyCamera() {
    const hw = this.width / 2 / this.ppu;
    const hh = this.height / 2 / this.ppu;
    const c = this.camera;
    c.left = -hw;
    c.right = hw;
    c.top = hh;
    c.bottom = -hh;
    c.position.set(this.camX, this.camY, 5);
    c.updateProjectionMatrix();
  }

  toScreen(x: number, y: number) {
    return {
      x: (x - this.camX) * this.ppu + this.width / 2,
      y: this.height / 2 - (y - this.camY) * this.ppu,
    };
  }

  render(dt: number) {
    const k = 1 - Math.exp(-dt * 7);
    this.camX += (this.targetX - this.camX) * k;
    this.camY += (this.targetY - this.camY) * k;
    this.applyCamera();
    this.composer.render();
  }
}

function glowTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
