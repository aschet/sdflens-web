// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Surface } from '../src/model';

/** A regular grid of ``rows`` by ``columns`` points; the height of a point is given by ``height``. */
export function grid(
  rows: number,
  columns: number,
  height: (row: number, column: number) => number = (r, c) => r * columns + c,
  step = 1e-6,
): Surface {
  const z = new Float32Array(rows * columns);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) z[r * columns + c] = height(r, c);
  return { kind: 'grid', columns, rows, stepX: step, stepY: step, z, x: null, y: null };
}

/** A profile with uneven spacing: the points lie at ``positions`` along x. */
export function unevenProfile(positions: number[]): Surface {
  const x = Float32Array.from(positions);
  return {
    kind: 'grid',
    columns: x.length,
    rows: 1,
    stepX: 0,
    stepY: 0,
    z: Float32Array.from(positions, (p) => p * 2),
    x,
    y: new Float32Array(x.length),
  };
}

export function cloud(points: number): Surface {
  const x = Float32Array.from({ length: points }, (_, i) => i * 1e-6);
  return {
    kind: 'cloud',
    columns: points,
    rows: 1,
    stepX: 0,
    stepY: 0,
    z: x.slice(),
    x,
    y: x.slice(),
  };
}
