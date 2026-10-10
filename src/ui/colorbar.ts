// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** The color scale next to the view: a gradient with ticks, and a swatch for points that are not measured. */

import { formatTick, niceTicks, unitFor } from "../units";

const BAR_LEFT = 12;
const BAR_WIDTH = 16;
const TOP = 28;
const BOTTOM = 12;
const SWATCH = 14;

export class Colorbar {
  private lut: Uint8Array | null = null;
  private range: [number, number] | null = null;
  private hasInvalid = false;
  private foreground = "#e6e6e6";
  private background = "#202227";
  private readonly observer: ResizeObserver;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(canvas);
  }

  update(lut: Uint8Array, range: [number, number], hasInvalid: boolean): void {
    this.lut = lut;
    this.range = range;
    this.hasInvalid = hasInvalid;
    this.draw();
  }

  setColors(foreground: string, background: string): void {
    this.foreground = foreground;
    this.background = background;
    this.draw();
  }

  draw(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    const context = this.canvas.getContext("2d") as CanvasRenderingContext2D;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const lut = this.lut;
    const range = this.range;
    const legend = this.hasInvalid ? SWATCH + 10 : 0;
    const barHeight = height - TOP - BOTTOM - legend;
    if (!lut || !range || barHeight < 20) return;

    const gradient = context.createLinearGradient(0, TOP, 0, TOP + barHeight);
    for (let i = 0; i < 256; i += 5) {
      const at = (255 - i) * 3;
      gradient.addColorStop(i / 255, `rgb(${lut[at]},${lut[at + 1]},${lut[at + 2]})`);
    }
    gradient.addColorStop(1, `rgb(${lut[0]},${lut[1]},${lut[2]})`);
    context.fillStyle = gradient;
    context.fillRect(BAR_LEFT, TOP, BAR_WIDTH, barHeight);
    context.strokeStyle = this.foreground;
    context.lineWidth = 1;
    context.strokeRect(BAR_LEFT + 0.5, TOP + 0.5, BAR_WIDTH, barHeight);

    const [lo, hi] = range;
    const [factor, symbol] = unitFor(Math.max(Math.abs(lo), Math.abs(hi)));
    context.fillStyle = this.foreground;
    context.font = "12px system-ui, sans-serif";
    context.textAlign = "left";
    context.fillText(symbol, BAR_LEFT, 18);
    if (hi > lo) {
      for (const tick of niceTicks(lo, hi, Math.max(2, Math.floor(barHeight / 40)))) {
        const y = Math.round(TOP + ((hi - tick) / (hi - lo)) * barHeight) + 0.5;
        const x = BAR_LEFT + BAR_WIDTH;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + 4, y);
        context.stroke();
        context.fillText(formatTick(tick, factor), x + 7, y + 4);
      }
    }
    if (this.hasInvalid) {
      const y = height - BOTTOM - SWATCH;
      context.fillStyle = this.background;
      context.fillRect(BAR_LEFT, y, SWATCH, SWATCH);
      context.strokeRect(BAR_LEFT + 0.5, y + 0.5, SWATCH, SWATCH);
      context.fillStyle = this.foreground;
      context.fillText(width >= 110 ? "not measured" : "no data", BAR_LEFT + SWATCH + 5, y + SWATCH - 2);
    }
  }
}
