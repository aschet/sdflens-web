// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** What the page decides about a file, apart from showing it: which views fit, which one to start with, and the status text. */

import { irregularProfile, type lateralRange, type Stats, type Surface } from './model';
import type { Tool } from './render/view3d';
import { formatExtent, formatLength } from './units';

export type ViewName = '3d' | '2d' | 'profile';

/** For each view, why it is not available, or null. */
export type Availability = Record<ViewName, string | null>;

/** The views that can show a surface; ``webglProblem`` says why WebGL does not work, if it does not. */
export function availableViews(
  surface: Surface | null,
  webglProblem: string | null,
): Availability {
  if (!surface) return { '3d': 'No file', '2d': 'No file', profile: 'No file' };
  const regular = surface.kind === 'grid' && surface.x === null;
  return {
    '3d': webglProblem,
    '2d':
      regular && surface.rows > 1 && surface.columns > 1
        ? null
        : 'Needs a surface on a regular grid',
    profile:
      regular || irregularProfile(surface)
        ? null
        : 'Needs a profile or a surface on a regular grid',
  };
}

/** The view that a file opens in: a profile in the profile view, anything else in 3D if it can, then 2D. */
export function startView(surface: Surface, available: Availability): ViewName {
  const profileOnly =
    surface.kind === 'grid' && (surface.rows === 1 || surface.columns === 1);
  if (profileOnly && available.profile === null) return 'profile';
  if (available['3d'] === null) return '3d';
  return available['2d'] === null ? '2d' : 'profile';
}

/** Rotating is for the 3D view only; the others pan instead. */
export function effectiveTool(view: ViewName, tool: Tool): Tool {
  return view !== '3d' && tool === 'rotate' ? 'pan' : tool;
}

/** The status text when nothing is under the cursor: the field of view and the peak to valley height. */
export function statusText(
  surface: Surface,
  stats: Stats,
  extent: ReturnType<typeof lateralRange>,
): string {
  const spans = (axis: 'x' | 'y'): boolean => extent[axis][1] > extent[axis][0];
  const field: number[] = [];
  // A regular grid covers its points times the step; otherwise the span of the positions is used. The span across
  // a profile counts if the positions vary, as along a diagonal.
  if (surface.kind === 'cloud' || surface.columns > 1 || (surface.x && spans('x'))) {
    field.push(surface.x ? extent.x[1] - extent.x[0] : surface.columns * surface.stepX);
  }
  if (surface.kind === 'cloud' || surface.rows > 1 || (surface.y && spans('y'))) {
    field.push(surface.y ? extent.y[1] - extent.y[0] : surface.rows * surface.stepY);
  }
  return `FOV ${formatExtent(field)}, PV ${formatLength(stats.max - stats.min)}`;
}

/** The index of the layer ``delta`` steps from ``current``, wrapping around. */
export function nextLayer(current: number, delta: number, count: number): number {
  return (((current + delta) % count) + count) % count;
}

/** The name of the picture file: the name of the file without its extension, and the view. */
export function screenshotName(fileName: string, view: ViewName): string {
  return `${fileName.replace(/\.[^.]+$/, '')}-${view}.png`;
}
