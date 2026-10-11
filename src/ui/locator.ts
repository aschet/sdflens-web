// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** A small map of the surface that shows where the profile lies while the slider moves. */

import type { Surface } from "../model";
import { reduce } from "../render/view2d";
import { formatLength } from "../units";

const HIDE_DELAY = 1200;
const LINE = "#ff9a1f";

export interface Placement {
  surface: Surface;
  range: [number, number];
  /** The colors, built only when the map has to be drawn again, and what they depend on. */
  lut: () => Uint8Array;
  lutKey: string;
  axis: "x" | "y";
  index: number;
}

export class Locator {
  private readonly canvas = document.createElement("canvas");
  private readonly caption = document.createElement("span");
  private cache: { surface: Surface; key: string; width: number; height: number; image: HTMLCanvasElement } | null = null;
  private timer = 0;
  private held = false;

  constructor(private readonly element: HTMLElement) {
    element.append(this.canvas, this.caption);
  }

  /** Shows the map with the profile marked. It stays while the slider is held and a moment after the last change. */
  show(p: Placement): void {
    const { surface: s } = p;
    if (s.rows < 2) return;
    const ratio = window.devicePixelRatio || 1;
    const narrow = window.matchMedia("(max-width: 760px)").matches;
    const [boxWidth, boxHeight] = narrow ? [112, 84] : [160, 120];
    const physicalWidth = s.columns * s.stepX;
    const physicalHeight = s.rows * s.stepY;
    const fit = Math.min(boxWidth / physicalWidth, boxHeight / physicalHeight);
    const cssWidth = Math.max(Math.round(physicalWidth * fit), 1);
    const cssHeight = Math.max(Math.round(physicalHeight * fit), 1);
    const width = Math.round(cssWidth * ratio);
    const height = Math.round(cssHeight * ratio);

    const key = `${p.lutKey}|${width}x${height}`;
    if (!this.cache || this.cache.surface !== s || this.cache.key !== key) {
      this.cache = { surface: s, key, width, height, image: this.render(p, width, height) };
    }

    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = width;
    this.canvas.height = height;
    const context = this.canvas.getContext("2d") as CanvasRenderingContext2D;
    // The first row of the surface is at the bottom, as in the 2D view.
    context.save();
    context.translate(0, height);
    context.scale(1, -1);
    context.imageSmoothingEnabled = true;
    context.drawImage(this.cache.image, 0, 0, width, height);
    context.restore();

    const along = p.axis === "x";
    context.beginPath();
    if (along) {
      const y = Math.round(height * (1 - (p.index + 0.5) / s.rows)) + 0.5;
      context.moveTo(0, y);
      context.lineTo(width, y);
    } else {
      const x = Math.round((width * (p.index + 0.5)) / s.columns) + 0.5;
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }
    context.lineCap = "butt";
    context.strokeStyle = "rgba(0, 0, 0, 0.55)";
    context.lineWidth = 3.5 * ratio;
    context.stroke();
    context.strokeStyle = LINE;
    context.lineWidth = 1.75 * ratio;
    context.stroke();

    this.caption.textContent = along ? `y=${formatLength(p.index * s.stepY)}` : `x=${formatLength(p.index * s.stepX)}`;
    this.element.classList.add("visible");
    window.clearTimeout(this.timer);
    if (!this.held) this.timer = window.setTimeout(() => this.hide(), HIDE_DELAY);
  }

  /** Keeps the map shown, as long as the slider is being dragged. */
  hold(): void {
    this.held = true;
    window.clearTimeout(this.timer);
  }

  release(): void {
    this.held = false;
    if (this.element.classList.contains("visible")) {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.hide(), HIDE_DELAY);
    }
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.held = false;
    this.element.classList.remove("visible");
  }

  /** The surface in the colors of the colormap, averaged down to about the size of the map. */
  private render(p: Placement, width: number, height: number): HTMLCanvasElement {
    const s = p.surface;
    const blockX = Math.max(Math.floor(s.columns / width), 1);
    const blockY = Math.max(Math.floor(s.rows / height), 1);
    const reduced = reduce(s.z, s.rows, s.columns, blockY, blockX);
    const columns = Math.ceil(s.columns / blockX);
    const rows = Math.ceil(s.rows / blockY);
    const image = document.createElement("canvas");
    image.width = columns;
    image.height = rows;
    const context = image.getContext("2d") as CanvasRenderingContext2D;
    const pixels = context.createImageData(columns, rows);
    const lut = p.lut();
    const [lo, hi] = p.range;
    const scale = hi > lo ? 255 / (hi - lo) : 0;
    for (let i = 0; i < reduced.length; i++) {
      const value = reduced[i] as number;
      const at = i * 4;
      if (value !== value) {
        pixels.data[at + 3] = 0;
        continue;
      }
      const level = Math.min(Math.max(Math.round((value - lo) * scale), 0), 255) * 3;
      pixels.data[at] = lut[level] as number;
      pixels.data[at + 1] = lut[level + 1] as number;
      pixels.data[at + 2] = lut[level + 2] as number;
      pixels.data[at + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return image;
  }
}
