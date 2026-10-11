// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** Picking in the 3D view: the measured point nearest to a position on the screen. */

import { multiply, type Mat4 } from './camera';

// Points of the visible surface lie at most this many pixel footprints behind the nearest point within the
// radius; points that are farther behind belong to a surface that is hidden.
const DEPTH_SLOPE = 3;
// Barycentric coordinates may be this far below zero, so that a click on an edge hits.
const EDGE_TOLERANCE = 1e-6;

export interface Projection {
  x: Float32Array;
  y: Float32Array;
  /** The distance in front of the camera; not positive for a point behind it. */
  depth: Float32Array;
}

/** The screen positions in pixels, y down, and the depths of ``vertices``. */
export function project(
  vertices: Float32Array,
  view: Mat4,
  proj: Mat4,
  zFactor: number,
  width: number,
  height: number,
): Projection {
  const matrix = multiply(proj, view);
  const at = (k: number): number => matrix[k] as number;
  const m0 = at(0);
  const m1 = at(1);
  const m2 = at(2);
  const m3 = at(3);
  const m4 = at(4);
  const m5 = at(5);
  const m6 = at(6);
  const m7 = at(7);
  const m12 = at(12);
  const m13 = at(13);
  const m14 = at(14);
  const m15 = at(15);
  const count = vertices.length / 3;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const depth = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const px = vertices[i * 3] as number;
    const py = vertices[i * 3 + 1] as number;
    const pz = (vertices[i * 3 + 2] as number) * zFactor;
    const w = m12 * px + m13 * py + m14 * pz + m15;
    const cx = m0 * px + m1 * py + m2 * pz + m3;
    const cy = m4 * px + m5 * py + m6 * pz + m7;
    depth[i] = w;
    x[i] = (cx / w + 1) * 0.5 * width;
    y[i] = (1 - cy / w) * 0.5 * height;
  }
  return { x, y, depth };
}

/** The vertex nearest to ``(px, py)`` in the front triangle there, or null if no triangle covers it. */
export function pickFace(
  projection: Projection,
  triangles: Uint32Array,
  px: number,
  py: number,
): number | null {
  const { x, y, depth } = projection;
  let bestDepth = Infinity;
  let best: number | null = null;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] as number;
    const b = triangles[t + 1] as number;
    const c = triangles[t + 2] as number;
    const ax = x[a] as number,
      ay = y[a] as number;
    const bx = x[b] as number,
      by = y[b] as number;
    const cx = x[c] as number,
      cy = y[c] as number;
    if (
      Math.min(ax, bx, cx) > px ||
      Math.max(ax, bx, cx) < px ||
      Math.min(ay, by, cy) > py ||
      Math.max(ay, by, cy) < py
    )
      continue;
    const dx0 = bx - ax,
      dy0 = by - ay,
      dx1 = cx - ax,
      dy1 = cy - ay;
    const dx2 = px - ax,
      dy2 = py - ay;
    const d00 = dx0 * dx0 + dy0 * dy0;
    const d01 = dx0 * dx1 + dy0 * dy1;
    const d11 = dx1 * dx1 + dy1 * dy1;
    const d20 = dx2 * dx0 + dy2 * dy0;
    const d21 = dx2 * dx1 + dy2 * dy1;
    const denominator = d00 * d11 - d01 * d01;
    if (denominator === 0) continue;
    const v = (d11 * d20 - d01 * d21) / denominator;
    const w = (d00 * d21 - d01 * d20) / denominator;
    const u = 1 - v - w;
    if (u < -EDGE_TOLERANCE || v < -EDGE_TOLERANCE || w < -EDGE_TOLERANCE) continue;
    const da = depth[a] as number,
      db = depth[b] as number,
      dc = depth[c] as number;
    if (da <= 0 || db <= 0 || dc <= 0) continue;
    // The inverse of the depth is linear on the screen.
    const covered = 1 / (u / da + v / db + w / dc);
    if (covered < bestDepth) {
      bestDepth = covered;
      best = u >= v && u >= w ? a : v >= w ? b : c;
    }
  }
  return best;
}

/** The visible measured vertex within ``radius`` pixels of ``(px, py)`` that is nearest to it, or null. */
export function pickVertex(
  projection: Projection,
  valid: Uint8Array,
  proj: Mat4,
  height: number,
  px: number,
  py: number,
  radius: number,
): number | null {
  const { x, y, depth } = projection;
  const near: number[] = [];
  let nearest = Infinity;
  for (let i = 0; i < valid.length; i++) {
    if (!valid[i] || (depth[i] as number) <= 0) continue;
    if (Math.hypot((x[i] as number) - px, (y[i] as number) - py) > radius) continue;
    near.push(i);
    if ((depth[i] as number) < nearest) nearest = depth[i] as number;
  }
  if (near.length === 0) return null;
  const footprint = (2 * nearest) / ((proj[5] as number) * height);
  const limit = nearest + DEPTH_SLOPE * radius * footprint;
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const i of near) {
    if ((depth[i] as number) > limit) continue;
    const distance = Math.hypot((x[i] as number) - px, (y[i] as number) - py);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** The index of the measured vertex that a click at ``(px, py)`` picks: a click on a triangle picks its nearest corner. */
export function pick(
  vertices: Float32Array,
  valid: Uint8Array,
  triangles: Uint32Array,
  view: Mat4,
  proj: Mat4,
  zFactor: number,
  px: number,
  py: number,
  width: number,
  height: number,
  radius: number,
): number | null {
  const projection = project(vertices, view, proj, zFactor, width, height);
  if (triangles.length) {
    const face = pickFace(projection, triangles, px, py);
    if (face !== null) return face;
  }
  return pickVertex(projection, valid, proj, height, px, py, radius);
}
