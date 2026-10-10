// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** Axes of the 2D and the profile view: grid, major and minor ticks, and titles. */

import { formatTick, niceTicks, unitFor } from "../units";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Colors {
  background: string;
  foreground: string;
  muted: string;
}

export interface AxisSpec {
  /** The visible interval, in meters. */
  lo: number;
  hi: number;
  /** The position on the canvas of a value. */
  toScreen(value: number): number;
  /** The name of the axis, shown with its unit. */
  title: string;
}

export const FONT = "11.5px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MAJOR = 6;
const MINOR = 3.5;
const MIN_MINOR_SPACING = 7;

/** The number of minor intervals in a major one: a step of 1 or 5 splits into 5, a step of 2 into 4. */
function minorDivisions(step: number): number {
  const mantissa = step / 10 ** Math.floor(Math.log10(step));
  return Math.abs(mantissa - 2) < 0.01 ? 4 : 5;
}

function minorTicks(lo: number, hi: number, major: number[]): number[] {
  if (major.length < 2) return [];
  const step = (major[1] as number) - (major[0] as number);
  const minorStep = step / minorDivisions(step);
  const ticks: number[] = [];
  for (let k = Math.ceil(lo / minorStep - 1e-9); k * minorStep <= hi + minorStep * 1e-9; k++) {
    const value = k * minorStep;
    const onMajor = Math.abs(value / step - Math.round(value / step)) < 1e-6;
    if (!onMajor) ticks.push(value);
  }
  return ticks;
}

/** The ticks of an axis for its length in pixels. */
function ticksFor(axis: AxisSpec, length: number, spacing: number): { major: number[]; minor: number[] } {
  const major = niceTicks(axis.lo, axis.hi, Math.max(2, Math.floor(length / spacing)));
  let minor = minorTicks(axis.lo, axis.hi, major);
  if (major.length >= 2) {
    const pixels = Math.abs(axis.toScreen(major[1] as number) - axis.toScreen(major[0] as number));
    if (pixels / minorDivisions((major[1] as number) - (major[0] as number)) < MIN_MINOR_SPACING) minor = [];
  }
  return { major, minor };
}

/**
 * Draws the axes along the left and the bottom edge of ``box``: a grid, ticks with labels in one common unit, and
 * a title for each axis. The context is left unclipped; the grid is clipped to the box.
 */
export function drawAxes(
  context: CanvasRenderingContext2D, box: Box, x: AxisSpec, y: AxisSpec, colors: Colors,
  options: { grid: boolean; zeroLine?: boolean },
): void {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const [xFactor, xSymbol] = unitFor(Math.max(Math.abs(x.lo), Math.abs(x.hi)));
  const [yFactor, ySymbol] = unitFor(Math.max(Math.abs(y.lo), Math.abs(y.hi)));
  const xTicks = ticksFor(x, box.width, 90);
  const yTicks = ticksFor(y, box.height, 56);
  const line = (x0: number, y0: number, x1: number, y1: number): void => {
    context.beginPath();
    context.moveTo(Math.round(x0) + 0.5, Math.round(y0) + 0.5);
    context.lineTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
    context.stroke();
  };

  context.save();
  context.font = FONT;
  context.lineWidth = 1;

  if (options.grid) {
    context.save();
    context.beginPath();
    context.rect(box.left, box.top, box.width, box.height);
    context.clip();
    context.strokeStyle = colors.muted;
    context.globalAlpha = 0.16;
    for (const tick of xTicks.major) line(x.toScreen(tick), box.top, x.toScreen(tick), bottom);
    for (const tick of yTicks.major) line(box.left, y.toScreen(tick), right, y.toScreen(tick));
    if (options.zeroLine && y.lo < 0 && y.hi > 0) {
      context.globalAlpha = 0.5;
      context.setLineDash([4, 4]);
      line(box.left, y.toScreen(0), right, y.toScreen(0));
    }
    context.restore();
  }

  // The axis lines, and the ticks pointing outwards.
  context.strokeStyle = colors.muted;
  context.globalAlpha = 0.85;
  line(box.left, box.top, box.left, bottom);
  line(box.left, bottom, right, bottom);
  for (const tick of xTicks.minor) line(x.toScreen(tick), bottom, x.toScreen(tick), bottom + MINOR);
  for (const tick of yTicks.minor) line(box.left, y.toScreen(tick), box.left - MINOR, y.toScreen(tick));
  context.globalAlpha = 1;
  for (const tick of xTicks.major) line(x.toScreen(tick), bottom, x.toScreen(tick), bottom + MAJOR);
  for (const tick of yTicks.major) line(box.left, y.toScreen(tick), box.left - MAJOR, y.toScreen(tick));

  context.fillStyle = colors.muted;
  context.textAlign = "center";
  for (const tick of xTicks.major) context.fillText(formatTick(tick, xFactor), x.toScreen(tick), bottom + MAJOR + 13);
  context.textAlign = "right";
  for (const tick of yTicks.major) context.fillText(formatTick(tick, yFactor), box.left - MAJOR - 4, y.toScreen(tick) + 4);

  // The titles: the unit follows the name, so that the labels stay short.
  context.fillStyle = colors.foreground;
  context.font = `600 ${FONT}`;
  context.textAlign = "right";
  context.fillText(`${x.title} (${xSymbol})`, right, bottom + MAJOR + 28);
  context.save();
  context.translate(14, box.top + box.height / 2);
  context.rotate(-Math.PI / 2);
  context.textAlign = "center";
  context.fillText(`${y.title} (${ySymbol})`, 0, 0);
  context.restore();
  context.restore();
}
