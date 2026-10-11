// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** Which profile of a surface is shown: along a row, along a column, or along the points of an irregular profile. */

import { irregularProfile, type Surface } from './model';
import { formatLength } from './units';

export type ProfileAxis = 'x' | 'y';

export interface Series {
  values: Float32Array;
  /** The distance between the points, in the mean for an irregular profile. */
  step: number;
  /** The number of profiles along the other axis, to choose from. */
  count: number;
  /** The positions of the points of an irregular profile, otherwise null. */
  positions: Float32Array | null;
}

/** The axis to start with: a single column is a profile along y. */
export function startAxis(surface: Surface): ProfileAxis {
  return surface.columns < 2 ? 'y' : 'x';
}

/** The profile in the middle of the surface along ``axis``. */
export function middleProfile(surface: Surface, axis: ProfileAxis): number {
  return Math.floor((axis === 'x' ? surface.rows : surface.columns) / 2);
}

/** The axis along which the profile runs; an irregular profile has its own. */
export function alongAxis(surface: Surface, axis: ProfileAxis): ProfileAxis {
  return irregularProfile(surface)?.axis ?? axis;
}

/** Whether a profile can run along ``axis``: it needs more than one point along it. */
export function canRun(surface: Surface, axis: ProfileAxis): boolean {
  return (axis === 'x' ? surface.columns : surface.rows) > 1;
}

/** The heights of profile number ``index`` along ``axis``. */
export function profileSeries(
  surface: Surface,
  axis: ProfileAxis,
  index: number,
): Series {
  const irregular = irregularProfile(surface);
  if (irregular) {
    const { positions } = irregular;
    const span = (positions[positions.length - 1] as number) - (positions[0] as number);
    return {
      values: surface.z,
      step: span / Math.max(positions.length - 1, 1) || 1,
      count: 1,
      positions,
    };
  }
  if (axis === 'x') {
    const row = Math.min(index, surface.rows - 1);
    // A view of the row, not a copy: a long profile is not copied for each step of the slider.
    const values = surface.z.subarray(
      row * surface.columns,
      (row + 1) * surface.columns,
    );
    return { values, step: surface.stepX, count: surface.rows, positions: null };
  }
  const column = Math.min(index, surface.columns - 1);
  const values = new Float32Array(surface.rows);
  for (let r = 0; r < surface.rows; r++)
    values[r] = surface.z[r * surface.columns + column] as number;
  return { values, step: surface.stepY, count: surface.columns, positions: null };
}

/** The text for a point of a profile: its position along the profile and its height. */
export function profileReadout(
  axis: ProfileAxis,
  position: number,
  value: number,
): string {
  const z = Number.isFinite(value) ? formatLength(value) : 'not measured';
  return `${axis}=${formatLength(position)}, z=${z}`;
}
