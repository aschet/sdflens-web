// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** The geometry of the 2D view: where the data lies in the plot, and how it is panned and zoomed. */

import type { Box } from './axes';

export interface Margins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The grid of points that the view shows; each point is centered on its coordinate. */
export interface GridShape {
  columns: number;
  rows: number;
  stepX: number;
  stepY: number;
}

/** The largest zoom, as the number of pixels that the larger step of the grid covers. */
const MAX_PIXELS_PER_STEP = 400;

export class Viewport2D {
  /** Pixels per meter, and the world position of the top left corner of the plot. */
  scale = 1;
  x0 = 0;
  y1 = 0;
  /** Whether the whole of the data is shown, which stays so when the view is resized. */
  fitted = true;

  private canvasWidth = 1;
  private canvasHeight = 1;
  private grid: GridShape | null = null;

  private readonly margins: Margins;

  constructor(margins: Margins) {
    this.margins = margins;
  }

  /** Sets the size of the canvas in pixels, and keeps the whole of the data in view if it was. */
  resize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
    if (this.fitted) this.fit();
  }

  setGrid(grid: GridShape | null): void {
    this.grid = grid;
  }

  get plotWidth(): number {
    return Math.max(this.canvasWidth - this.margins.left - this.margins.right, 1);
  }

  get plotHeight(): number {
    return Math.max(this.canvasHeight - this.margins.top - this.margins.bottom, 1);
  }

  /** The area covered by the points, in meters. */
  bounds(): { x0: number; y0: number; x1: number; y1: number } {
    const { columns, rows, stepX, stepY } = this.grid as GridShape;
    return {
      x0: -0.5 * stepX,
      y0: -0.5 * stepY,
      x1: (columns - 0.5) * stepX,
      y1: (rows - 0.5) * stepY,
    };
  }

  /** The scale at which the whole of the data fills the plot. */
  fitScale(): number {
    const b = this.bounds();
    return Math.min(this.plotWidth / (b.x1 - b.x0), this.plotHeight / (b.y1 - b.y0));
  }

  /** Shows the whole of the data, centered. */
  fit(): void {
    if (!this.grid) return;
    const b = this.bounds();
    this.scale = this.fitScale();
    this.x0 = b.x0 - (this.plotWidth / this.scale - (b.x1 - b.x0)) / 2;
    this.y1 = b.y1 + (this.plotHeight / this.scale - (b.y1 - b.y0)) / 2;
  }

  home(): void {
    this.fitted = true;
    this.fit();
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [
      this.margins.left + (wx - this.x0) * this.scale,
      this.margins.top + (this.y1 - wy) * this.scale,
    ];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [
      this.x0 + (sx - this.margins.left) / this.scale,
      this.y1 - (sy - this.margins.top) / this.scale,
    ];
  }

  /** Zooms by ``factor`` about the point (``px``, ``py``) of the plot, which stays where it is. */
  zoomAt(factor: number, px: number, py: number): void {
    if (!this.grid) return;
    this.fitted = false;
    const [wx, wy] = this.toWorld(this.margins.left + px, this.margins.top + py);
    const smallest = this.fitScale() * 0.5;
    const largest = Math.max(
      MAX_PIXELS_PER_STEP / Math.max(this.grid.stepX, this.grid.stepY),
      smallest,
    );
    this.scale = Math.min(Math.max(this.scale * factor, smallest), largest);
    this.x0 = wx - px / this.scale;
    this.y1 = wy + py / this.scale;
  }

  /** Moves the data by (``dx``, ``dy``) pixels. */
  panBy(dx: number, dy: number): void {
    this.fitted = false;
    this.x0 -= dx / this.scale;
    this.y1 += dy / this.scale;
  }

  /** The part of the plot that the data covers, in pixels of the canvas. */
  dataBox(): Box {
    const b = this.bounds();
    const [left, top] = this.toScreen(b.x0, b.y1);
    const [right, bottom] = this.toScreen(b.x1, b.y0);
    const l = Math.max(left, this.margins.left);
    const t = Math.max(top, this.margins.top);
    return {
      left: l,
      top: t,
      width: Math.max(Math.min(right, this.margins.left + this.plotWidth) - l, 1),
      height: Math.max(Math.min(bottom, this.margins.top + this.plotHeight) - t, 1),
    };
  }

  /** The part of the data that is in the plot, in meters, along x and along y. */
  visible(): { x: [number, number]; y: [number, number] } {
    const b = this.bounds();
    const [wx0, wy1] = this.toWorld(this.margins.left, this.margins.top);
    const [wx1, wy0] = this.toWorld(
      this.margins.left + this.plotWidth,
      this.margins.top + this.plotHeight,
    );
    return {
      x: [Math.max(wx0, b.x0), Math.min(wx1, b.x1)],
      y: [Math.max(wy0, b.y0), Math.min(wy1, b.y1)],
    };
  }
}
