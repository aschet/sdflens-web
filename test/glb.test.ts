// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBytes } from 'gltf-validator';
import { describe, expect, it } from 'vitest';
import { readFile } from '../src/formats';
import { glbBytes } from '../src/glb';
import type { Surface } from '../src/model';
import { buildMesh } from '../src/render/mesh';
import { canExportModel, modelName } from '../src/viewing';
import { grid } from './helpers';

interface Accessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
}

interface Primitive {
  attributes: Record<string, number>;
  mode: number;
  indices?: number;
}

interface Parsed {
  document: {
    asset: { extras: Record<string, unknown> };
    meshes: { primitives: Primitive[] }[];
    materials: { pbrMetallicRoughness: { metallicFactor: number } }[];
    accessors: Accessor[];
    bufferViews: { byteOffset: number; byteLength: number }[];
  };
  binary: Uint8Array;
}

function parse(data: Uint8Array): Parsed {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(data.length);
  const textLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a);
  const document = JSON.parse(
    new TextDecoder().decode(data.subarray(20, 20 + textLength)),
  ) as Parsed['document'];
  const binaryLength = view.getUint32(20 + textLength, true);
  expect(view.getUint32(24 + textLength, true)).toBe(0x004e4942);
  const start = 28 + textLength;
  return { document, binary: data.slice(start, start + binaryLength) };
}

function slice(parsed: Parsed, index: number, size: number): ArrayBuffer {
  const accessor = parsed.document.accessors[index] as Accessor;
  const view = parsed.document.bufferViews[
    accessor.bufferView
  ] as Parsed['document']['bufferViews'][number];
  return (parsed.binary.buffer as ArrayBuffer).slice(
    view.byteOffset,
    view.byteOffset + accessor.count * size,
  );
}

function floats(parsed: Parsed, index: number): Float32Array {
  const accessor = parsed.document.accessors[index] as Accessor;
  return new Float32Array(slice(parsed, index, accessor.type === 'VEC3' ? 12 : 4));
}

function indices(parsed: Parsed, index: number): Uint32Array {
  return new Uint32Array(slice(parsed, index, 4));
}

function primitiveOf(parsed: Parsed): Primitive {
  return parsed.document.meshes[0]?.primitives[0] as Primitive;
}

function positionsOf(parsed: Parsed): Float32Array {
  return floats(parsed, primitiveOf(parsed).attributes.POSITION as number);
}

function build(surface: Surface): Parsed {
  return parse(glbBytes(buildMesh(surface), 'test'));
}

function range(values: Float32Array, axis: number): number {
  const along = Array.from(values.filter((_, i) => i % 3 === axis));
  return Math.max(...along) - Math.min(...along);
}

describe('GLB export', () => {
  it('writes the triangles with normals of a surface, and no colors', () => {
    const surface = grid(4, 5, (r, c) => (r * 5 + c) * 1e-9);
    surface.z[4] = NaN;
    const parsed = build(surface);
    const primitive = primitiveOf(parsed);
    expect(primitive.mode).toBe(4);
    const positions = floats(parsed, primitive.attributes.POSITION as number);
    const normals = floats(parsed, primitive.attributes.NORMAL as number);
    const triangles = indices(parsed, primitive.indices as number);
    // The point that is not measured has no vertex, and every index refers to one that is written.
    expect(positions.length / 3).toBe(4 * 5 - 1);
    expect(normals.length).toBe(positions.length);
    expect(Math.max(...triangles)).toBeLessThan(positions.length / 3);
    for (let i = 0; i < normals.length; i += 3)
      expect(
        Math.hypot(
          normals[i] as number,
          normals[i + 1] as number,
          normals[i + 2] as number,
        ),
      ).toBeCloseTo(1, 5);
    expect(primitive.attributes.COLOR_0).toBeUndefined();
    expect(parsed.document.materials[0]?.pbrMetallicRoughness.metallicFactor).toBe(0);
  });

  it('stands the surface up in meters, so that distances can be measured', () => {
    const surface = grid(4, 6, (r, c) => (r * 6 + c) * 1e-9, 2e-6);
    const positions = positionsOf(build(surface));
    expect(range(positions, 0)).toBeCloseTo(10e-6, 11); // 5 steps of 2 µm
    expect(range(positions, 2)).toBeCloseTo(6e-6, 11); // 3 steps of 2 µm, along -y
    expect(range(positions, 1)).toBeCloseTo(23e-9, 12); // y is up, the heights are not exaggerated
  });

  it('gives a flat surface normals that point up', () => {
    const parsed = build(grid(3, 4, () => 1e-9));
    const normals = floats(parsed, primitiveOf(parsed).attributes.NORMAL as number);
    for (let i = 0; i < normals.length; i += 3) {
      expect(normals[i]).toBeCloseTo(0, 6);
      expect(normals[i + 1]).toBeCloseTo(1, 6);
      expect(normals[i + 2]).toBeCloseTo(0, 6);
    }
  });

  it('writes a point cloud as points', () => {
    const cloud: Surface = {
      kind: 'cloud',
      columns: 4,
      rows: 1,
      stepX: 0,
      stepY: 0,
      z: Float32Array.from([0, 1e-6, 0, 2e-6]),
      x: Float32Array.from([0, 1e-6, 2e-6, 3e-6]),
      y: Float32Array.from([0, 2e-6, 1e-6, 0]),
    };
    const parsed = build(cloud);
    const primitive = primitiveOf(parsed);
    expect(primitive.mode).toBe(0);
    expect(primitive.indices).toBeUndefined();
    expect(primitive.attributes.NORMAL).toBeUndefined();
    expect(positionsOf(parsed).length).toBe(12);
    expect(range(positionsOf(parsed), 0)).toBeCloseTo(3e-6, 12);
  });

  it('keeps the unit and the origin of the data in the asset', () => {
    const extras = build(grid(4, 6, () => 0, 2e-6)).document.asset.extras;
    expect(extras.unit).toBe('meters');
    expect(extras.extent_meters).toEqual([
      expect.closeTo(10e-6, 12),
      expect.closeTo(6e-6, 12),
    ]);
    expect(extras.origin_meters).toEqual([
      expect.closeTo(5e-6, 12),
      expect.closeTo(3e-6, 12),
      expect.closeTo(0, 12),
    ]);
    expect(extras.z_factor).toBeUndefined();
  });

  it('refuses a surface without measured points', () => {
    const empty = grid(2, 2, () => NaN);
    expect(() => glbBytes(buildMesh(empty), 'test')).toThrow('measured');
  });

  it('is a valid glTF file, for a surface and for points', async () => {
    const surface = grid(30, 40, (r, c) => Math.sin(r / 4) * Math.cos(c / 5) * 1e-6);
    const cloud: Surface = {
      kind: 'cloud',
      columns: 3,
      rows: 1,
      stepX: 0,
      stepY: 0,
      z: Float32Array.from([0, 1e-6, 2e-6]),
      x: Float32Array.from([0, 1e-6, 2e-6]),
      y: Float32Array.from([0, 0, 1e-6]),
    };
    for (const data of [surface, cloud]) {
      const report = await validateBytes(glbBytes(buildMesh(data), 'test'));
      expect(report.issues.messages).toEqual([]);
      expect(report.issues.numErrors + report.issues.numWarnings).toBe(0);
    }
  });

  it('is offered for a surface but not for a profile, and is named after the file', () => {
    expect(canExportModel(grid(4, 5))).toBe(true);
    expect(canExportModel(grid(1, 5))).toBe(false);
    expect(canExportModel(grid(5, 1))).toBe(false);
    expect(canExportModel({ ...grid(1, 5), profile: true })).toBe(false);
    expect(canExportModel(null)).toBe(false);
    expect(modelName('lens.array.sdf')).toBe('lens.array.glb');
  });
});

interface Want {
  vertices: number;
  mode: number;
  positions: number[];
  extentMeters: number[];
  indices?: number;
  indexSum?: number;
  normals?: number[];
}

const wanted = JSON.parse(
  readFileSync(join(process.cwd(), 'test', 'expected-glb.json'), 'utf-8'),
) as Record<string, Want>;

function sums(values: Float32Array): number[] {
  const out = [0, 0, 0];
  for (let i = 0; i < values.length; i++)
    out[i % 3] = (out[i % 3] as number) + (values[i] as number);
  return out;
}

describe('GLB export of the sample files', () => {
  for (const [name, want] of Object.entries(wanted)) {
    it(`matches what sdflens writes for ${name}`, () => {
      const data = new Uint8Array(
        readFileSync(join(process.cwd(), 'test', 'samples', name)),
      );
      const surface = readFile(data, name).layer(0);
      expect(canExportModel(surface)).toBe(true);
      const parsed = parse(glbBytes(buildMesh(surface), 'test'));
      const primitive = primitiveOf(parsed);
      const positions = positionsOf(parsed);
      expect(primitive.mode).toBe(want.mode);
      expect(positions.length / 3).toBe(want.vertices);
      // The heights of the page are float32, so the sums agree to about seven digits of the size.
      const size = Math.max(...want.extentMeters);
      const tolerance = 1e-4 * want.vertices * size;
      sums(positions).forEach((value, i) => {
        expect(Math.abs(value - (want.positions[i] as number))).toBeLessThanOrEqual(
          tolerance,
        );
      });
      const extent = parsed.document.asset.extras.extent_meters as number[];
      expect(extent[0]).toBeCloseTo(want.extentMeters[0] as number, 9);
      expect(extent[1]).toBeCloseTo(want.extentMeters[1] as number, 9);
      if (primitive.indices !== undefined) {
        const triangles = indices(parsed, primitive.indices);
        expect(triangles.length).toBe(want.indices);
        expect(triangles.reduce((total, value) => total + value, 0)).toBe(
          want.indexSum,
        );
        const normals = sums(floats(parsed, primitive.attributes.NORMAL as number));
        normals.forEach((value, i) => {
          expect(
            Math.abs(value - ((want.normals as number[])[i] as number)),
          ).toBeLessThanOrEqual(1e-4 * want.vertices);
        });
      }
    });
  }
});
