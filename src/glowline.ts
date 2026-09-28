import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

/**
 * Dicke Linie mit festem Maximalbudget an Punkten. Die Puffer werden jedes
 * Frame direkt beschrieben statt neu angelegt. Normal geblendet (additiv gäbe
 * helle Perlen an den Segmentstößen); Ausblenden = Richtung Schwarz dimmen,
 * neuere Punkte liegen oben.
 */
export class GlowLine {
  readonly obj: Line2;
  readonly mat: LineMaterial;
  readonly max: number;
  private geo: LineGeometry;
  private posBuf: THREE.InterleavedBuffer;
  private colBuf: THREE.InterleavedBuffer;
  private pos: Float32Array;
  private col: Float32Array;
  private width: number;

  constructor(max: number, width: number) {
    this.max = max;
    this.width = width;
    this.geo = new LineGeometry();
    this.geo.setPositions(new Float32Array(max * 3));
    this.geo.setColors(new Float32Array(max * 3));
    this.posBuf = (this.geo.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data;
    this.colBuf = (this.geo.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute).data;
    this.posBuf.setUsage(THREE.DynamicDrawUsage);
    this.colBuf.setUsage(THREE.DynamicDrawUsage);
    this.pos = this.posBuf.array as Float32Array;
    this.col = this.colBuf.array as Float32Array;
    this.geo.instanceCount = 0;

    this.mat = new LineMaterial({
      vertexColors: true,
      linewidth: width,
      depthTest: false,
      depthWrite: false,
    });
    this.obj = new Line2(this.geo, this.mat);
    this.obj.frustumCulled = false;
  }

  /** points: xyz je Punkt, colors: rgb je Punkt (null = weiß), n Punkte */
  set(points: ArrayLike<number>, colors: ArrayLike<number> | null, n: number) {
    n = Math.min(n, this.max);
    const pos = this.pos;
    const col = this.col;
    for (let i = 0; i < n - 1; i++) {
      const s = i * 6;
      const p = i * 3;
      pos[s] = points[p];
      pos[s + 1] = points[p + 1];
      pos[s + 2] = points[p + 2];
      pos[s + 3] = points[p + 3];
      pos[s + 4] = points[p + 4];
      pos[s + 5] = points[p + 5];
      if (colors) {
        col[s] = colors[p];
        col[s + 1] = colors[p + 1];
        col[s + 2] = colors[p + 2];
        col[s + 3] = colors[p + 3];
        col[s + 4] = colors[p + 4];
        col[s + 5] = colors[p + 5];
      } else {
        col.fill(1, s, s + 6);
      }
    }
    const used = Math.max(0, n - 1) * 6;
    this.posBuf.clearUpdateRanges();
    this.posBuf.addUpdateRange(0, used);
    this.posBuf.needsUpdate = true;
    this.colBuf.clearUpdateRanges();
    this.colBuf.addUpdateRange(0, used);
    this.colBuf.needsUpdate = true;
    this.geo.instanceCount = Math.max(0, n - 1);
  }

  setResolution(w: number, h: number, dpr: number) {
    this.mat.resolution.set(w, h);
    this.mat.linewidth = this.width * dpr;
  }
}
