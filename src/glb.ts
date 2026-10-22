// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** The geometry of the 3D view as a binary glTF (GLB) file: the surface as triangles with normals, or a cloud as points. */

import type { Mesh } from './render/mesh';

const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const POINTS = 0;
const TRIANGLES = 4;

interface Part {
  data: Uint8Array;
  target: number;
  type: 'SCALAR' | 'VEC3';
  component: number;
  count: number;
}

/** The bytes of ``array`` as they lie in memory, which is little endian on every platform that runs a browser. */
function bytes(array: Float32Array | Uint8Array | Uint32Array): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

/** Unit vertex normals: the face normals around each vertex, weighted by area. */
function vertexNormals(vertices: Float32Array, triangles: Uint32Array): Float32Array {
  const sums = new Float64Array(vertices.length);
  for (let t = 0; t < triangles.length; t += 3) {
    const a = (triangles[t] as number) * 3;
    const b = (triangles[t + 1] as number) * 3;
    const c = (triangles[t + 2] as number) * 3;
    const ux = (vertices[b] as number) - (vertices[a] as number);
    const uy = (vertices[b + 1] as number) - (vertices[a + 1] as number);
    const uz = (vertices[b + 2] as number) - (vertices[a + 2] as number);
    const vx = (vertices[c] as number) - (vertices[a] as number);
    const vy = (vertices[c + 1] as number) - (vertices[a + 1] as number);
    const vz = (vertices[c + 2] as number) - (vertices[a + 2] as number);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const corner of [a, b, c]) {
      sums[corner] = (sums[corner] as number) + nx;
      sums[corner + 1] = (sums[corner + 1] as number) + ny;
      sums[corner + 2] = (sums[corner + 2] as number) + nz;
    }
  }
  const normals = new Float32Array(vertices.length);
  for (let i = 0; i < sums.length; i += 3) {
    const length = Math.hypot(
      sums[i] as number,
      sums[i + 1] as number,
      sums[i + 2] as number,
    );
    const scale = length > 0 ? 1 / length : 1;
    normals[i] = (sums[i] as number) * scale;
    normals[i + 1] = (sums[i + 1] as number) * scale;
    normals[i + 2] = (sums[i + 2] as number) * scale;
  }
  return normals;
}

function padded(data: Uint8Array, filler: number): Uint8Array {
  const out = new Uint8Array(data.length + ((4 - (data.length % 4)) % 4)).fill(filler);
  out.set(data);
  return out;
}

/**
 * The GLB file of ``mesh``: its triangles with normals, or its points.
 *
 * The geometry is the real one, in meters, which glTF uses for its units, so that distances can be measured in the
 * file. The height is not exaggerated and the vertices have no colors; a viewer can do both. The model is centered at
 * the origin; where it lay in the coordinates of the data is stored in the ``extras`` of the asset.
 */
export function glbBytes(mesh: Mesh, generator: string): Uint8Array<ArrayBuffer> {
  // Only the vertices of measured points are written; the others have placeholders.
  const total = mesh.vertices.length / 3;
  const renumber = new Int32Array(total).fill(-1);
  const used: number[] = [];
  for (let i = 0; i < total; i++) {
    if (mesh.isCloud || mesh.valid[i]) {
      renumber[i] = used.length;
      used.push(i);
    }
  }
  if (used.length === 0) throw new Error('There are no measured points to export');

  // z up becomes y up, which glTF has. The mesh is normalized: the normals do not depend on the size, and the
  // positions are scaled to meters.
  const vertices = new Float32Array(used.length * 3);
  const positions = new Float32Array(used.length * 3);
  used.forEach((source, target) => {
    const x = mesh.vertices[source * 3] as number;
    const y = mesh.vertices[source * 3 + 1] as number;
    const z = mesh.vertices[source * 3 + 2] as number;
    vertices[target * 3] = x;
    vertices[target * 3 + 1] = z;
    vertices[target * 3 + 2] = -y;
    positions[target * 3] = x * mesh.scale;
    positions[target * 3 + 1] = z * mesh.scale;
    positions[target * 3 + 2] = -y * mesh.scale;
  });
  const triangles = new Uint32Array(mesh.isCloud ? 0 : mesh.triangles.length);
  for (let i = 0; i < triangles.length; i++)
    triangles[i] = renumber[mesh.triangles[i] as number] as number;

  const parts: Part[] = [
    {
      data: bytes(positions),
      target: ARRAY_BUFFER,
      type: 'VEC3',
      component: FLOAT,
      count: used.length,
    },
  ];
  const attributes: Record<string, number> = { POSITION: 0 };
  if (triangles.length > 0) {
    parts.push({
      data: bytes(vertexNormals(vertices, triangles)),
      target: ARRAY_BUFFER,
      type: 'VEC3',
      component: FLOAT,
      count: used.length,
    });
    attributes.NORMAL = parts.length - 1;
  }
  if (triangles.length > 0) {
    parts.push({
      data: bytes(triangles),
      target: ELEMENT_ARRAY_BUFFER,
      type: 'SCALAR',
      component: UNSIGNED_INT,
      count: triangles.length,
    });
  }

  const chunks: Uint8Array[] = [];
  const views: object[] = [];
  const accessors: Record<string, unknown>[] = [];
  let offset = 0;
  for (const part of parts) {
    const data = padded(part.data, 0);
    views.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: part.data.length,
      target: part.target,
    });
    accessors.push({
      bufferView: views.length - 1,
      componentType: part.component,
      count: part.count,
      type: part.type,
    });
    chunks.push(data);
    offset += data.length;
  }
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    low[axis] = Math.min(low[axis] as number, positions[i] as number);
    high[axis] = Math.max(high[axis] as number, positions[i] as number);
  }
  (accessors[0] as Record<string, unknown>).min = low;
  (accessors[0] as Record<string, unknown>).max = high;

  const primitive: Record<string, unknown> = {
    attributes,
    material: 0,
    mode: triangles.length > 0 ? TRIANGLES : POINTS,
  };
  if (triangles.length > 0) primitive.indices = parts.length - 1;
  const document = {
    asset: {
      version: '2.0',
      generator,
      extras: {
        unit: 'meters',
        extent_meters: [mesh.extent[0] * mesh.scale, mesh.extent[1] * mesh.scale],
        origin_meters: mesh.origin,
      },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'surface' }],
    meshes: [{ primitives: [primitive] }],
    // Without a material glTF means a fully metallic one, which looks dark in most viewers.
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.3, 0.3, 0.3, 1],
          metallicFactor: 0,
          roughnessFactor: 0.85,
        },
        doubleSided: true,
      },
    ],
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors,
  };
  const text = padded(new TextEncoder().encode(JSON.stringify(document)), 0x20);
  const length = 12 + 8 + text.length + 8 + offset;
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  view.setUint32(12, text.length, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(text, 20);
  const binary = 20 + text.length;
  view.setUint32(binary, offset, true);
  view.setUint32(binary + 4, 0x004e4942, true); // "BIN"
  let at = binary + 8;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
