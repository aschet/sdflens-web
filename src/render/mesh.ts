// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Surface } from '../model';

/** Grids with more points are thinned out for the mesh, to about 2000 x 2000. */
export const MAX_MESH_POINTS = 4_000_000;

/**
 * Vertices and primitives that draw a surface or a point cloud.
 *
 * Positions are centered and divided by ``scale``, the largest lateral extent in meters, which keeps float32 well
 * conditioned for micrometer sized data. A point that is not measured has a placeholder vertex that no primitive uses.
 */
export interface Mesh {
  vertices: Float32Array;
  triangles: Uint32Array;
  lines: Uint32Array;
  /** 1 for a measured vertex. */
  valid: Uint8Array;
  isCloud: boolean;
  /** Position in meters of the vertex at the normalized origin, and the factor to meters. */
  origin: [number, number, number];
  scale: number;
  /** The extent of the data in units of ``scale``, and its height range. */
  extent: [number, number];
  heightFraction: number;
  zMin: number;
  zMax: number;
}

function step(rows: number, columns: number): number {
  const ratio = (rows * columns) / MAX_MESH_POINTS;
  if (ratio <= 1) return 1;
  return Math.ceil(Math.min(rows, columns) < 2 ? ratio : Math.sqrt(ratio));
}

/** Every ``stride``-th index below ``count``, and always the last one. */
function sampleIndices(count: number, stride: number): number[] {
  const indices: number[] = [];
  for (let i = 0; i < count; i += stride) indices.push(i);
  if (indices[indices.length - 1] !== count - 1) indices.push(count - 1);
  return indices;
}

export function buildMesh(surface: Surface): Mesh {
  return surface.kind === 'cloud' ? cloudMesh(surface) : gridMesh(surface);
}

function finiteRange(values: ArrayLike<number>, valid?: Uint8Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (valid && !valid[i]) continue;
    const value = values[i] as number;
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return Number.isFinite(min) ? [min, max] : [0, 0];
}

function gridMesh(surface: Surface): Mesh {
  const stride = step(surface.rows, surface.columns);
  const rowIndices = sampleIndices(surface.rows, stride);
  const columnIndices = sampleIndices(surface.columns, stride);
  const rows = rowIndices.length;
  const columns = columnIndices.length;
  const count = rows * columns;
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const z = new Float64Array(count);
  const valid = new Uint8Array(count);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const source =
        (rowIndices[r] as number) * surface.columns + (columnIndices[c] as number);
      const target = r * columns + c;
      const height = surface.z[source] as number;
      const px = surface.x
        ? (surface.x[source] as number)
        : (columnIndices[c] as number) * surface.stepX;
      const py = surface.y
        ? (surface.y[source] as number)
        : (rowIndices[r] as number) * surface.stepY;
      x[target] = px;
      y[target] = py;
      z[target] = height;
      valid[target] =
        Number.isFinite(height) && Number.isFinite(px) && Number.isFinite(py) ? 1 : 0;
    }
  }
  return assemble(x, y, z, valid, { rows, columns, cloud: false });
}

function cloudMesh(surface: Surface): Mesh {
  const count = surface.z.length;
  const valid = new Uint8Array(count).fill(1);
  return assemble(
    Float64Array.from(surface.x as Float32Array),
    Float64Array.from(surface.y as Float32Array),
    Float64Array.from(surface.z),
    valid,
    { rows: 1, columns: count, cloud: true },
  );
}

function assemble(
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  valid: Uint8Array,
  shape: { rows: number; columns: number; cloud: boolean },
): Mesh {
  const [xMin, xMax] = finiteRange(x, valid);
  const [yMin, yMax] = finiteRange(y, valid);
  const [zMin, zMax] = finiteRange(z, valid);
  const extentX = xMax - xMin;
  const extentY = yMax - yMin;
  // The largest lateral extent; a single point or a vertical line falls back to the height range.
  const lateral = Math.max(extentX, extentY);
  const scale = lateral > 0 ? lateral : zMax > zMin ? zMax - zMin : 1e-6;
  const origin: [number, number, number] = [
    0.5 * (xMin + xMax),
    0.5 * (yMin + yMax),
    0.5 * (zMin + zMax),
  ];
  const count = z.length;
  const vertices = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    if (!valid[i]) continue;
    vertices[i * 3] = ((x[i] as number) - origin[0]) / scale;
    vertices[i * 3 + 1] = ((y[i] as number) - origin[1]) / scale;
    vertices[i * 3 + 2] = ((z[i] as number) - origin[2]) / scale;
  }
  const { rows, columns } = shape;
  const triangles = shape.cloud
    ? new Uint32Array(0)
    : triangleIndices(valid, rows, columns);
  const lines = shape.cloud ? new Uint32Array(0) : lineIndices(valid, rows, columns);
  return {
    vertices,
    triangles,
    lines,
    valid,
    isCloud: shape.cloud,
    origin,
    scale,
    extent: [extentX / scale, extentY / scale],
    heightFraction: (zMax - zMin) / scale,
    zMin,
    zMax,
  };
}

/** Two counter-clockwise triangles, seen from +z, for each cell whose four corners are measured. */
export function triangleIndices(
  valid: Uint8Array,
  rows: number,
  columns: number,
): Uint32Array {
  if (rows < 2 || columns < 2) return new Uint32Array(0);
  let cells = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const i = r * columns + c;
      if (valid[i] && valid[i + 1] && valid[i + columns] && valid[i + columns + 1])
        cells++;
    }
  }
  const out = new Uint32Array(cells * 6);
  let at = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const i00 = r * columns + c;
      const i01 = i00 + 1;
      const i10 = i00 + columns;
      const i11 = i10 + 1;
      if (valid[i00] && valid[i01] && valid[i10] && valid[i11]) {
        out[at++] = i00;
        out[at++] = i01;
        out[at++] = i11;
        out[at++] = i00;
        out[at++] = i11;
        out[at++] = i10;
      }
    }
  }
  return out;
}

/** Line segments between all pairs of neighbouring measured points. */
export function lineIndices(
  valid: Uint8Array,
  rows: number,
  columns: number,
): Uint32Array {
  let segments = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (!valid[i]) continue;
      if (c + 1 < columns && valid[i + 1]) segments++;
      if (r + 1 < rows && valid[i + columns]) segments++;
    }
  }
  const out = new Uint32Array(segments * 2);
  let at = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (!valid[i]) continue;
      if (c + 1 < columns && valid[i + 1]) {
        out[at++] = i;
        out[at++] = i + 1;
      }
      if (r + 1 < rows && valid[i + columns]) {
        out[at++] = i;
        out[at++] = i + columns;
      }
    }
  }
  return out;
}

/** The position in meters of vertex ``index``. */
export function vertexPosition(mesh: Mesh, index: number): [number, number, number] {
  const v = mesh.vertices;
  return [
    (v[index * 3] as number) * mesh.scale + mesh.origin[0],
    (v[index * 3 + 1] as number) * mesh.scale + mesh.origin[1],
    (v[index * 3 + 2] as number) * mesh.scale + mesh.origin[2],
  ];
}
