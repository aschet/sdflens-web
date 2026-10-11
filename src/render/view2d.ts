// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** 2D view of a grid: the heights as a colormapped image with rulers, pan and zoom. */

import type { Surface } from '../model';
import { formatLength } from '../units';
import { drawAxes } from './axes';
import type { Tool } from './view3d';
import { Viewport2D } from './viewport';

const LEFT = 48;
const TOP = 8;
const RIGHT = 14;
const BOTTOM = 36;
const ZOOM_STEP = 1.2;
const CLICK_DISTANCE = 4;
const MAX_LEVEL_SIDE = 8192;
const MAX_LEVEL_POINTS = 50_000_000;

interface Style {
  background: string;
  foreground: string;
  muted: string;
}

/** The power of two of points to average along an axis for the number of device pixels each point covers. */
export function blockSize(pixelsPerPoint: number, count: number): number {
  if (pixelsPerPoint >= 0.5) return 1;
  return Math.min(
    2 ** Math.floor(Math.log2(1 / pixelsPerPoint)),
    2 ** Math.floor(Math.log2(Math.max(count, 1))),
  );
}

/** The averages of blocks of measured points; a block without a measured point is NaN. */
export function reduce(
  data: Float32Array,
  rows: number,
  columns: number,
  blockY: number,
  blockX: number,
): Float32Array {
  const outRows = Math.ceil(rows / blockY);
  const outColumns = Math.ceil(columns / blockX);
  const out = new Float32Array(outRows * outColumns);
  for (let r = 0; r < outRows; r++) {
    for (let c = 0; c < outColumns; c++) {
      let sum = 0;
      let measured = 0;
      const endY = Math.min((r + 1) * blockY, rows);
      const endX = Math.min((c + 1) * blockX, columns);
      for (let y = r * blockY; y < endY; y++) {
        for (let x = c * blockX; x < endX; x++) {
          const value = data[y * columns + x] as number;
          if (value === value) {
            sum += value;
            measured++;
          }
        }
      }
      out[r * outColumns + c] = measured ? sum / measured : NaN;
    }
  }
  return out;
}

export class View2D {
  /** Called with a text for the point under the cursor, empty when the cursor is outside of the data. */
  onHover: (text: string) => void = () => undefined;

  private readonly canvas = document.createElement('canvas');
  private readonly observer: ResizeObserver;
  private surface: Surface | null = null;
  private lut: Uint8Array | null = null;
  private range: [number, number] = [0, 1];
  private levels = new Map<string, HTMLCanvasElement>();
  private tool: Tool = 'pan';
  private style: Style = {
    background: '#1e1f22',
    foreground: '#e6e6e6',
    muted: '#9a9a9a',
  };

  private width = 1;
  private height = 1;
  private ratio = 1;
  private readonly view = new Viewport2D({
    left: LEFT,
    top: TOP,
    right: RIGHT,
    bottom: BOTTOM,
  });
  private frame = 0;
  private marker: { column: number; row: number } | null = null;

  private readonly pointers = new Map<
    number,
    { x: number; y: number; button: number; type: string }
  >();
  private press: { x: number; y: number; moved: boolean } | null = null;
  private pinch: { distance: number; x: number; y: number } | null = null;

  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.canvas.className = 'plane';
    this.canvas.style.touchAction = 'none';
    host.append(this.canvas);
    this.canvas.addEventListener('pointerdown', (event) => {
      this.onPointerDown(event);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      this.onPointerMove(event);
    });
    this.canvas.addEventListener('pointerup', (event) => {
      this.onPointerUp(event);
    });
    this.canvas.addEventListener('pointercancel', (event) => {
      this.onPointerUp(event, true);
    });
    this.canvas.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' && this.pointers.size === 0) this.onHover('');
    });
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        this.onWheel(event);
      },
      {
        passive: false,
      },
    );
    this.canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });
    this.observer = new ResizeObserver(() => {
      this.resize();
    });
    this.observer.observe(host);
    this.resize();
  }

  setStyle(style: Style): void {
    this.style = style;
    this.requestRender();
  }

  /** Shows ``surface``, a grid with regular axes; ``keepView`` keeps pan and zoom. */
  setSurface(surface: Surface | null, range: [number, number], keepView = false): void {
    this.surface = surface;
    this.range = range;
    this.levels.clear();
    this.marker = null;
    this.view.setGrid(surface);
    if (!keepView) this.view.home();
    this.requestRender();
  }

  setLut(lut: Uint8Array): void {
    this.lut = lut;
    this.levels.clear();
    this.requestRender();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
  }

  home(): void {
    this.view.home();
    this.requestRender();
  }

  zoomIn(): void {
    this.zoomAt(ZOOM_STEP, this.view.plotWidth / 2, this.view.plotHeight / 2);
  }

  zoomOut(): void {
    this.zoomAt(1 / ZOOM_STEP, this.view.plotWidth / 2, this.view.plotHeight / 2);
  }

  snapshot(): Promise<Blob> {
    this.render();
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('No image'));
      }, 'image/png');
    });
  }

  dispose(): void {
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    this.canvas.remove();
  }

  // -------------------------------------------------------------------------------------------- geometry

  private zoomAt(factor: number, px: number, py: number): void {
    this.view.zoomAt(factor, px, py);
    this.requestRender();
  }

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    this.ratio = window.devicePixelRatio || 1;
    this.width = Math.max(Math.round(rect.width), 1);
    this.height = Math.max(Math.round(rect.height), 1);
    this.canvas.width = Math.round(this.width * this.ratio);
    this.canvas.height = Math.round(this.height * this.ratio);
    this.view.resize(this.width, this.height);
    this.requestRender();
  }

  // ------------------------------------------------------------------------------------------- rendering

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private level(blockY: number, blockX: number): HTMLCanvasElement {
    const key = `${blockY},${blockX}`;
    const cached = this.levels.get(key);
    if (cached) return cached;
    const s = this.surface as Surface;
    const lut = this.lut as Uint8Array;
    const data =
      blockY > 1 || blockX > 1 ? reduce(s.z, s.rows, s.columns, blockY, blockX) : s.z;
    const columns = Math.ceil(s.columns / blockX);
    const rows = Math.ceil(s.rows / blockY);
    const [lo, hi] = this.range;
    const span = hi - lo;
    const pixels = new Uint8ClampedArray(columns * rows * 4);
    for (let r = 0; r < rows; r++) {
      // y grows with the row index, so row 0 belongs at the bottom of the image.
      const target = (rows - 1 - r) * columns;
      for (let c = 0; c < columns; c++) {
        const value = data[r * columns + c] as number;
        const at = (target + c) * 4;
        if (value !== value) continue;
        const fraction = span > 0 ? (value - lo) / span : 0;
        const index = Math.round(Math.min(Math.max(fraction, 0), 1) * 255) * 3;
        pixels[at] = lut[index] as number;
        pixels[at + 1] = lut[index + 1] as number;
        pixels[at + 2] = lut[index + 2] as number;
        pixels[at + 3] = 255;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = columns;
    canvas.height = rows;
    (canvas.getContext('2d') as CanvasRenderingContext2D).putImageData(
      new ImageData(pixels, columns, rows),
      0,
      0,
    );
    this.levels.set(key, canvas);
    return canvas;
  }

  private render(): void {
    const context = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.fillStyle = this.style.background;
    context.fillRect(0, 0, this.width, this.height);
    const s = this.surface;
    if (!s || !this.lut || this.view.plotWidth < 10 || this.view.plotHeight < 10)
      return;

    const b = this.view.bounds();
    const [left, top] = this.view.toScreen(b.x0, b.y1);
    const [right, bottom] = this.view.toScreen(b.x1, b.y0);
    // Points that cover less than half a device pixel are averaged, separately along each axis.
    const pointX = this.view.scale * s.stepX * this.ratio;
    const pointY = this.view.scale * s.stepY * this.ratio;
    let blockX = blockSize(pointX, s.columns);
    let blockY = blockSize(pointY, s.rows);
    while (
      Math.ceil(s.columns / blockX) > MAX_LEVEL_SIDE ||
      Math.ceil(s.rows / blockY) > MAX_LEVEL_SIDE ||
      Math.ceil(s.columns / blockX) * Math.ceil(s.rows / blockY) > MAX_LEVEL_POINTS
    ) {
      blockX *= 2;
      blockY *= 2;
    }
    const image = this.level(blockY, blockX);
    const smooth = pointX * blockX < 1 && pointY * blockY < 1;

    context.save();
    context.beginPath();
    context.rect(LEFT, TOP, this.view.plotWidth, this.view.plotHeight);
    context.clip();
    context.imageSmoothingEnabled = smooth;
    // Draw only the part of the image that is visible, so that a zoom into a large image stays cheap.
    const clipLeft = Math.max(left, LEFT);
    const clipRight = Math.min(right, LEFT + this.view.plotWidth);
    const clipTop = Math.max(top, TOP);
    const clipBottom = Math.min(bottom, TOP + this.view.plotHeight);
    if (clipRight > clipLeft && clipBottom > clipTop) {
      const sx = ((clipLeft - left) / (right - left)) * image.width;
      const sw = ((clipRight - clipLeft) / (right - left)) * image.width;
      const sy = ((clipTop - top) / (bottom - top)) * image.height;
      const sh = ((clipBottom - clipTop) / (bottom - top)) * image.height;
      context.drawImage(
        image,
        sx,
        sy,
        sw,
        sh,
        clipLeft,
        clipTop,
        clipRight - clipLeft,
        clipBottom - clipTop,
      );
    }
    // The edge of the data, so that the image is framed where it does not fill the plot.
    context.strokeStyle = this.style.muted;
    context.globalAlpha = 0.7;
    context.lineWidth = 1;
    context.strokeRect(
      Math.round(left) + 0.5,
      Math.round(top) + 0.5,
      Math.round(right - left),
      Math.round(bottom - top),
    );
    context.globalAlpha = 1;
    this.drawMarker(context);
    context.restore();
    this.drawAxes(context);
  }

  private drawMarker(context: CanvasRenderingContext2D): void {
    const s = this.surface as Surface;
    if (!this.marker) return;
    const [x, y] = this.view.toScreen(
      this.marker.column * s.stepX,
      this.marker.row * s.stepY,
    );
    context.beginPath();
    context.arc(x, y, 4.5, 0, Math.PI * 2);
    context.fillStyle = '#e67814';
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = this.style.background;
    context.stroke();
  }

  private drawAxes(context: CanvasRenderingContext2D): void {
    const { x, y } = this.view.visible();
    drawAxes(
      context,
      this.view.dataBox(),
      {
        lo: x[0],
        hi: x[1],
        toScreen: (v) => this.view.toScreen(v, 0)[0],
        title: 'x',
      },
      {
        lo: y[0],
        hi: y[1],
        toScreen: (v) => this.view.toScreen(0, v)[1],
        title: 'y',
      },
      this.style,
      { grid: false },
    );
  }

  // ---------------------------------------------------------------------------------------- interaction

  private describe(
    sx: number,
    sy: number,
  ): { text: string; column: number; row: number } | null {
    const s = this.surface;
    if (!s) return null;
    const [wx, wy] = this.view.toWorld(sx, sy);
    const column = Math.floor(wx / s.stepX + 0.5);
    const row = Math.floor(wy / s.stepY + 0.5);
    if (column < 0 || column >= s.columns || row < 0 || row >= s.rows) return null;
    const value = s.z[row * s.columns + column] as number;
    const z = Number.isFinite(value) ? formatLength(value) : 'not measured';
    return {
      text: `x=${formatLength(column * s.stepX)}, y=${formatLength(row * s.stepY)}, z=${z}`,
      column,
      row,
    };
  }

  private local(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown(event: PointerEvent): void {
    const { x, y } = this.local(event);
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, {
      x,
      y,
      button: event.button,
      type: event.pointerType,
    });
    if (this.pointers.size === 1) {
      this.press = { x, y, moved: false };
    } else {
      this.press = null;
      this.pinch = this.pinchState();
    }
  }

  private pinchState(): { distance: number; x: number; y: number } | null {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return null;
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  }

  private onPointerMove(event: PointerEvent): void {
    const { x, y } = this.local(event);
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      const hit = this.describe(x, y);
      this.onHover(hit ? hit.text : '');
      return;
    }
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    pointer.x = x;
    pointer.y = y;
    if (this.pointers.size >= 2) {
      const now = this.pinchState();
      if (now && this.pinch && this.pinch.distance > 0) {
        this.zoomAt(now.distance / this.pinch.distance, now.x - LEFT, now.y - TOP);
        this.view.panBy(now.x - this.pinch.x, now.y - this.pinch.y);
      }
      this.pinch = now;
      this.requestRender();
      return;
    }
    if (this.press && Math.hypot(x - this.press.x, y - this.press.y) > CLICK_DISTANCE)
      this.press.moved = true;
    let tool = this.tool === 'zoom' ? 'zoom' : 'pan';
    if (pointer.type === 'mouse') {
      if (pointer.button === 1) tool = 'pan';
      else if (pointer.button === 2) tool = 'zoom';
    }
    this.view.fitted = false;
    if (tool === 'pan') {
      this.view.panBy(dx, dy);
      this.requestRender();
    } else {
      this.zoomAt(Math.exp(-dy * 0.01), x - LEFT, y - TOP);
    }
  }

  private onPointerUp(event: PointerEvent, cancelled = false): void {
    const pointer = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const press = this.press;
    if (this.pointers.size === 0) this.press = null;
    if (cancelled || !pointer || !press || press.moved || pointer.button !== 0) return;
    // A tap marks the point, which is how a touch screen reads a value; a mouse reads it by hovering.
    if (pointer.type !== 'touch') return;
    const hit = this.describe(press.x, press.y);
    this.marker = hit ? { column: hit.column, row: hit.row } : null;
    this.onHover(hit ? hit.text : '');
    this.requestRender();
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const { left, top } = this.canvas.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 33 : 1);
    this.zoomAt(
      ZOOM_STEP ** (-delta / 100),
      event.clientX - left - LEFT,
      event.clientY - top - TOP,
    );
  }
}
