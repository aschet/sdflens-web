// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** One topography: a grid of heights, or a cloud of points. Lengths are in meters, NaN is not measured. */
export interface Surface {
  kind: "grid" | "cloud";
  /** Points along x of a grid, the number of points of a cloud. */
  columns: number;
  /** Rows of a grid, 1 for a profile and for a cloud. */
  rows: number;
  /** Distance between neighbouring columns and rows of a grid with regular axes. */
  stepX: number;
  stepY: number;
  /** Heights, row by row. */
  z: Float32Array;
  /** Positions of the points when the axes are not regular, otherwise null. */
  x: Float32Array | null;
  y: Float32Array | null;
}

export interface InfoSection {
  title: string;
  rows: [label: string, value: string][];
}

export interface SurfaceFile {
  format: "sdf" | "x3p";
  name: string;
  layerCount: number;
  /** Decodes layer ``index``, counted from 0. */
  layer(index: number): Surface;
  info: InfoSection[];
}

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

export interface Stats {
  min: number;
  max: number;
  measured: number;
  invalid: number;
}

/** Range of the measured heights and the number of measured and not measured points. */
export function statistics(surface: Surface): Stats {
  let min = Infinity;
  let max = -Infinity;
  let measured = 0;
  const { z, x, y } = surface;
  for (let i = 0; i < z.length; i++) {
    const value = z[i] as number;
    if (!Number.isFinite(value) || (x && !Number.isFinite(x[i] as number)) || (y && !Number.isFinite(y[i] as number))) {
      continue;
    }
    measured++;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max, measured, invalid: z.length - measured };
}

/** The lateral extent of the measured points as [lo, hi] along x and y. */
export function lateralRange(surface: Surface): { x: [number, number]; y: [number, number] } {
  const range = (values: Float32Array | null, count: number, step: number): [number, number] => {
    if (!values) return [0, (count - 1) * step];
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const value = values[i] as number;
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
    return [lo, hi];
  };
  const x = range(surface.x, surface.columns, surface.stepX);
  const y = range(surface.y, surface.rows, surface.stepY);
  return { x, y };
}
