// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** Profile view: the height along one row or column of a grid. */

import { drawAxes, type Box } from './axes';

const LEFT = 48;
const TOP = 8;
const RIGHT = 14;
const BOTTOM = 36;
const ZOOM_STEP = 1.2;
const MIN_POINTS = 3;
const MARKER_RADIUS = 4.5;
const CLICK_DISTANCE = 4;
const LINE_COLOR = '#3f8fe0';
const MARKER_COLOR = '#e67814';

export interface Envelope {
  columns: Int32Array;
  low: Float64Array;
  high: Float64Array;
}

/**
 * The columns that hold measured points, with the lowest and the highest value of each.
 *
 * The index interval [first, last) is split into ``columns`` equal parts; a part covers the points whose index lies
 * inside it. Parts without a measured point are left out.
 */
export function envelope(
  values: ArrayLike<number>,
  first: number,
  last: number,
  columns: number,
): Envelope {
  const columnsOut: number[] = [];
  const low: number[] = [];
  const high: number[] = [];
  const clip = (value: number): number => Math.min(Math.max(value, 0), values.length);
  for (let column = 0; column < columns; column++) {
    const from = clip(Math.ceil(first + ((last - first) * column) / columns));
    const to = clip(Math.ceil(first + ((last - first) * (column + 1)) / columns));
    let min = Infinity;
    let max = -Infinity;
    for (let i = from; i < to; i++) {
      const value = values[i] as number;
      if (value !== value) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (max >= min) {
      columnsOut.push(column);
      low.push(min);
      high.push(max);
    }
  }
  return {
    columns: Int32Array.from(columnsOut),
    low: Float64Array.from(low),
    high: Float64Array.from(high),
  };
}

/** The ranges of the columns, extended so that each touches the next adjacent column. */
export function connect(
  columns: Int32Array,
  low: Float64Array,
  high: Float64Array,
): { low: Float64Array; high: Float64Array } {
  const lo = low.slice();
  const hi = high.slice();
  for (let i = 0; i + 1 < columns.length; i++) {
    if ((columns[i + 1] as number) - (columns[i] as number) !== 1) continue;
    if ((high[i] as number) < (low[i + 1] as number)) hi[i] = low[i + 1] as number;
    else if ((low[i] as number) > (high[i + 1] as number))
      lo[i] = high[i + 1] as number;
  }
  return { low: lo, high: hi };
}

/**
 * The columns that hold measured points of a profile with irregular positions, with the lowest and the highest
 * value of each. The interval [lo, hi] of positions is split into ``columns`` equal parts.
 */
export function positionEnvelope(
  values: ArrayLike<number>,
  positions: ArrayLike<number>,
  start: number,
  stop: number,
  lo: number,
  hi: number,
  columns: number,
): Envelope {
  const low = new Float64Array(columns).fill(Infinity);
  const high = new Float64Array(columns).fill(-Infinity);
  const scale = columns / (hi - lo);
  for (let i = start; i < stop; i++) {
    const value = values[i] as number;
    if (value !== value) continue;
    const column = Math.floor(((positions[i] as number) - lo) * scale);
    if (column < 0 || column >= columns) continue;
    if (value < (low[column] as number)) low[column] = value;
    if (value > (high[column] as number)) high[column] = value;
  }
  const kept: number[] = [];
  for (let column = 0; column < columns; column++)
    if ((high[column] as number) >= (low[column] as number)) kept.push(column);
  return {
    columns: Int32Array.from(kept),
    low: Float64Array.from(kept, (c) => low[c] as number),
    high: Float64Array.from(kept, (c) => high[c] as number),
  };
}

/** The first index whose position is not below ``target``, for positions in increasing order. */
export function lowerBound(positions: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = positions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((positions[mid] as number) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Style {
  background: string;
  foreground: string;
  muted: string;
}

export class ProfilePlot {
  /** Called with the index of the point under the cursor, or -1. */
  onHover: (index: number) => void = () => undefined;

  private readonly canvas = document.createElement('canvas');
  private readonly observer: ResizeObserver;
  private values: Float32Array = new Float32Array(0);
  private step = 1;
  /** The positions of the points of an irregular profile, in increasing order, or null for a regular one. */
  private positions: Float32Array | null = null;
  private axis = 'x';
  private x0 = 0;
  private span = 1;
  private hover = -1;
  private tool: 'pan' | 'zoom' = 'pan';
  private style: Style = {
    background: '#1e1f22',
    foreground: '#e6e6e6',
    muted: '#9a9a9a',
  };
  private width = 1;
  private height = 1;
  private ratio = 1;
  private frame = 0;
  private readonly pointers = new Map<
    number,
    { x: number; y: number; type: string; button: number }
  >();
  private press: { x: number; y: number; moved: boolean } | null = null;
  private pinch: { distance: number; x: number } | null = null;

  constructor(private readonly host: HTMLElement) {
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
      if (event.pointerType === 'mouse' && this.pointers.size === 0) this.setHover(-1);
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

  /** The action of the left mouse button: dragging pans, or zooms about the cursor. */
  setTool(tool: 'pan' | 'zoom'): void {
    this.tool = tool;
  }

  setStyle(style: Style): void {
    this.style = style;
    this.requestRender();
  }

  /**
   * Shows ``values`` along ``axis``, spaced ``step`` meters apart, or at ``positions`` if the profile is irregular. A
   * series of the same size keeps the zoom.
   */
  setSeries(
    values: Float32Array,
    step: number,
    axis: string,
    positions: Float32Array | null = null,
  ): void {
    const same =
      values.length === this.values.length &&
      step === this.step &&
      (positions === null) === (this.positions === null);
    this.values = values;
    this.step = step;
    this.positions = positions;
    this.axis = axis;
    this.hover = -1;
    if (same) this.requestRender();
    else this.home();
  }

  /** The position along the profile of a point. */
  positionAt(index: number): number {
    return this.positions ? (this.positions[index] as number) : index * this.step;
  }

  valueAt(index: number): number {
    return this.values[index] as number;
  }

  home(): void {
    const [low, high] = this.full();
    this.x0 = low;
    this.span = high - low;
    this.requestRender();
  }

  zoomIn(): void {
    this.zoomAt(ZOOM_STEP, this.plotWidth() / 2);
  }

  zoomOut(): void {
    this.zoomAt(1 / ZOOM_STEP, this.plotWidth() / 2);
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

  private full(): [number, number] {
    const count = this.values.length;
    if (this.positions && count > 1) {
      const first = this.positions[0] as number;
      const last = this.positions[count - 1] as number;
      return [first - 0.5 * this.step, last + 0.5 * this.step];
    }
    return [-0.5 * this.step, (Math.max(count, 1) - 0.5) * this.step];
  }

  private plotWidth(): number {
    return Math.max(this.width - LEFT - RIGHT, 1);
  }

  private plotHeight(): number {
    return Math.max(this.height - TOP - BOTTOM, 1);
  }

  private zoomAt(factor: number, px: number): void {
    const [low, high] = this.full();
    const anchor = this.x0 + (px / this.plotWidth()) * this.span;
    const span = Math.min(
      Math.max(this.span / factor, Math.min(MIN_POINTS * this.step, high - low)),
      high - low,
    );
    this.x0 = Math.min(
      Math.max(anchor - (px / this.plotWidth()) * span, low),
      high - span,
    );
    this.span = span;
    this.requestRender();
  }

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    this.ratio = window.devicePixelRatio || 1;
    this.width = Math.max(Math.round(rect.width), 1);
    this.height = Math.max(Math.round(rect.height), 1);
    this.canvas.width = Math.round(this.width * this.ratio);
    this.canvas.height = Math.round(this.height * this.ratio);
    this.requestRender();
  }

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const context = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.fillStyle = this.style.background;
    context.fillRect(0, 0, this.width, this.height);
    const plotWidth = this.plotWidth();
    const plotHeight = this.plotHeight();
    if (this.values.length === 0 || plotWidth < 10 || plotHeight < 10) return;

    const xLo = this.x0;
    const xHi = this.x0 + this.span;
    const positions = this.positions;
    const first = xLo / this.step;
    const last = xHi / this.step;
    // The indices of the visible points; a line is continued to the neighbours of the first and the last.
    const start = positions
      ? Math.max(0, lowerBound(positions, xLo) - 1)
      : Math.max(0, Math.ceil(first));
    const stop = positions
      ? Math.min(this.values.length, lowerBound(positions, xHi) + 1)
      : Math.min(this.values.length, Math.floor(last) + 1);
    const [zLo, zHi] = zRange(this.values.subarray(start, stop));

    context.save();
    context.beginPath();
    context.rect(LEFT, TOP, plotWidth, plotHeight);
    context.clip();
    context.strokeStyle = LINE_COLOR;
    context.fillStyle = LINE_COLOR;
    context.lineWidth = 1;
    const bottom = TOP + plotHeight;
    const factor = plotHeight / (zHi - zLo);
    if ((positions ? stop - start : last - first) / plotWidth >= 1) {
      this.drawEnvelope(context, first, last, zLo, factor, bottom, start, stop);
    } else {
      this.drawPoints(context, start, stop, zLo, factor, bottom);
    }
    if (this.hover >= 0 && Number.isFinite(this.values[this.hover])) {
      const x =
        LEFT + ((this.positionAt(this.hover) - this.x0) / this.span) * plotWidth;
      const y = bottom - ((this.values[this.hover] as number) - zLo) * factor;
      context.beginPath();
      context.arc(x, y, MARKER_RADIUS, 0, Math.PI * 2);
      context.fillStyle = MARKER_COLOR;
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = this.style.background;
      context.stroke();
    }
    context.restore();
    const box: Box = { left: LEFT, top: TOP, width: plotWidth, height: plotHeight };
    drawAxes(
      context,
      box,
      {
        lo: Math.max(xLo, this.full()[0]),
        hi: Math.min(xHi, this.full()[1]),
        toScreen: (v) => LEFT + ((v - this.x0) / this.span) * plotWidth,
        title: this.axis,
      },
      { lo: zLo, hi: zHi, toScreen: (v) => bottom - (v - zLo) * factor, title: 'z' },
      this.style,
      { grid: true, zeroLine: true },
    );
  }

  private drawEnvelope(
    context: CanvasRenderingContext2D,
    first: number,
    last: number,
    zLo: number,
    factor: number,
    bottom: number,
    start: number,
    stop: number,
  ): void {
    const plotWidth = Math.round(this.plotWidth());
    const raw = this.positions
      ? positionEnvelope(
          this.values,
          this.positions,
          start,
          stop,
          this.x0,
          this.x0 + this.span,
          plotWidth,
        )
      : envelope(this.values, first, last, plotWidth);
    const { low, high } = connect(raw.columns, raw.low, raw.high);
    context.beginPath();
    for (let i = 0; i < raw.columns.length; i++) {
      const x = LEFT + (raw.columns[i] as number) + 0.5;
      // A column with a single point is drawn as a dot of one pixel.
      const top = bottom - ((high[i] as number) - zLo) * factor;
      const base = bottom - ((low[i] as number) - zLo) * factor;
      context.rect(x - 0.5, Math.min(top, base), 1, Math.max(Math.abs(base - top), 1));
    }
    context.fill();
  }

  private drawPoints(
    context: CanvasRenderingContext2D,
    start: number,
    stop: number,
    zLo: number,
    factor: number,
    bottom: number,
  ): void {
    const plotWidth = this.plotWidth();
    context.beginPath();
    let open = false;
    for (let i = start; i < stop; i++) {
      const value = this.values[i] as number;
      if (value !== value) {
        open = false;
        continue;
      }
      const x = LEFT + ((this.positionAt(i) - this.x0) / this.span) * plotWidth;
      const y = bottom - (value - zLo) * factor;
      if (open) context.lineTo(x, y);
      else context.moveTo(x, y);
      open = true;
    }
    context.stroke();
  }

  private indexAt(x: number, y: number): number {
    const inside =
      x >= LEFT &&
      x <= LEFT + this.plotWidth() &&
      y >= TOP &&
      y <= TOP + this.plotHeight();
    if (!inside) return -1;
    const position = this.x0 + ((x - LEFT) / this.plotWidth()) * this.span;
    if (this.positions) {
      // The nearest point of an irregular profile.
      const above = lowerBound(this.positions, position);
      const below = above - 1;
      const index =
        above >= this.values.length ||
        (below >= 0 &&
          position - (this.positions[below] as number) <=
            (this.positions[above] as number) - position)
          ? below
          : above;
      return index >= 0 && index < this.values.length ? index : -1;
    }
    const index = Math.round(position / this.step);
    return index >= 0 && index < this.values.length ? index : -1;
  }

  private setHover(index: number): void {
    if (index !== this.hover) {
      this.hover = index;
      this.requestRender();
    }
    this.onHover(index);
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
      type: event.pointerType,
      button: event.button,
    });
    if (this.pointers.size === 1) {
      this.press = { x, y, moved: false };
    } else {
      this.press = null;
      this.pinch = this.pinchState();
    }
  }

  private pinchState(): { distance: number; x: number } | null {
    const [a, b] = [...this.pointers.values()];
    return a && b ? { distance: Math.abs(a.x - b.x), x: (a.x + b.x) / 2 } : null;
  }

  private onPointerMove(event: PointerEvent): void {
    const { x, y } = this.local(event);
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      this.setHover(this.indexAt(x, y));
      return;
    }
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    pointer.x = x;
    pointer.y = y;
    if (this.pointers.size >= 2) {
      const now = this.pinchState();
      if (now && this.pinch && this.pinch.distance > 0)
        this.zoomAt(now.distance / this.pinch.distance, now.x - LEFT);
      this.pinch = now;
      return;
    }
    if (this.press && Math.hypot(x - this.press.x, y - this.press.y) > CLICK_DISTANCE)
      this.press.moved = true;
    if (this.press?.moved) this.setHover(-1);
    let tool = this.tool;
    if (pointer.type === 'mouse') {
      if (pointer.button === 1) tool = 'pan';
      else if (pointer.button === 2) tool = 'zoom';
    }
    if (tool === 'zoom') {
      this.zoomAt(Math.exp(-dy * 0.01), x - LEFT);
      return;
    }
    const [low, high] = this.full();
    const shift = (dx / this.plotWidth()) * this.span;
    this.x0 = Math.min(Math.max(this.x0 - shift, low), high - this.span);
    this.requestRender();
  }

  private onPointerUp(event: PointerEvent, cancelled = false): void {
    const pointer = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const press = this.press;
    if (this.pointers.size === 0) this.press = null;
    if (cancelled || !pointer || !press || press.moved || pointer.type === 'mouse')
      return;
    // A tap reads the point, which is how a touch screen shows a value.
    this.setHover(this.indexAt(press.x, press.y));
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const { left } = this.canvas.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 33 : 1);
    this.zoomAt(ZOOM_STEP ** (-delta / 100), event.clientX - left - LEFT);
  }
}

/** The height interval of the visible points with a margin; never empty. */
export function zRange(visible: Float32Array): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const value of visible) {
    if (value !== value) continue;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (!Number.isFinite(low)) return [0, 1];
  const pad = high > low ? 0.05 * (high - low) : 0.5 * Math.abs(low) || 1e-9;
  return [low - pad, high + pad];
}
