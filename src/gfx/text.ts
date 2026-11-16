import { CanvasTexture, DoubleSide, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';

export interface PanelStyle {
  color?: string;
  glow?: string;
  fontPx?: number;
  weight?: number;
  /** fill behind the text */
  bg?: string;
  border?: boolean;
}

/** In-world text panel (diegetic UI). Backed by a canvas texture, billboards around Y. */
export class TextPanel extends Mesh {
  private readonly cv: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: CanvasTexture;
  private current = '';
  private fade = 0;
  private target = 0;
  readonly widthM: number;

  constructor(widthM = 0.9, heightM = 0.28, px = 512) {
    const cv = document.createElement('canvas');
    cv.width = px;
    cv.height = Math.round(px * (heightM / widthM));
    const tex = new CanvasTexture(cv);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    super(
      new PlaneGeometry(widthM, heightM),
      new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide, opacity: 0 }),
    );
    this.cv = cv;
    this.ctx = cv.getContext('2d')!;
    this.tex = tex;
    this.widthM = widthM;
    this.renderOrder = 30;
    this.visible = false;
  }

  setText(text: string, style: PanelStyle = {}): void {
    const key = text + JSON.stringify(style);
    if (key === this.current) return;
    this.current = key;
    const { width: w, height: h } = this.cv;
    const g = this.ctx;
    g.clearRect(0, 0, w, h);
    const color = style.color ?? '#eaf8ff';
    const glow = style.glow ?? '#38b6ff';
    if (style.bg !== undefined || style.border) {
      const r = h * 0.28;
      g.beginPath();
      g.roundRect(6, 6, w - 12, h - 12, r);
      g.fillStyle = style.bg ?? 'rgba(6,10,24,0.72)';
      g.fill();
      if (style.border) {
        g.lineWidth = 5;
        g.strokeStyle = glow;
        g.shadowColor = glow;
        g.shadowBlur = 18;
        g.stroke();
        g.shadowBlur = 0;
      }
    }
    const lines = text.split('\n');
    let size = style.fontPx ?? h * 0.42;
    const weight = style.weight ?? 800;
    const fit = () => {
      g.font = `${weight} ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
      return Math.max(...lines.map((l) => g.measureText(l).width));
    };
    while (fit() > w * 0.9 && size > 12) size -= 2;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = glow;
    g.shadowBlur = 16;
    g.fillStyle = color;
    const lh = size * 1.18;
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh));
    g.shadowBlur = 0;
    this.tex.needsUpdate = true;
  }

  show(on: boolean): void {
    this.target = on ? 1 : 0;
    if (on) this.visible = true;
  }

  /** Fade + billboard toward `head` (around Y only, so it stays upright). */
  update(dt: number, head: Vector3): void {
    this.fade += (this.target - this.fade) * Math.min(1, dt * 7);
    (this.material as MeshBasicMaterial).opacity = this.fade;
    if (this.fade < 0.01 && this.target === 0) {
      this.visible = false;
      return;
    }
    const p = this.position;
    this.rotation.y = Math.atan2(head.x - p.x, head.z - p.z);
  }
}
