// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBytes } from 'gltf-validator';
import { describe, expect, it } from 'vitest';
import { buildLut } from '../src/colormap';
import { readFile } from '../src/formats';
import { glbBytes } from '../src/glb';
import type { Surface } from '../src/model';
import { buildMesh } from '../src/render/mesh';
import { canExportModel, modelName } from '../src/viewing';
import { grid } from './helpers';

const LUT = buildLut('Viridis');

interface Accessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  min?: number[];
  max?: number[];
}

interface Parsed {
  document: {
    asset: { extras: Record<string, unknown> };
    meshes: {
      primitives: {
        attributes: Record<string, number>;
        mode: number;
        indices?: number;
      }[];
    }[];
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

function floats(parsed: Parsed, index: number): Float32Array {
  const accessor = parsed.document.accessors[index] as Accessor;
  const view = parsed.document.bufferViews[
    accessor.bufferView
  ] as Parsed['document']['bufferViews'][number];
  const width = accessor.type === 'VEC3' ? 3 : 1;
  return new Float32Array(
    parsed.binary.buffer.slice(
      view.byteOffset,
      view.byteOffset + accessor.count * width * 4,
    ),
  );
}

function bytesOf(parsed: Parsed, index: number): Uint8Array {
  const accessor = parsed.document.accessors[index] as Accessor;
  const view = parsed.document.bufferViews[
    accessor.bufferView
  ] as Parsed['document']['bufferViews'][number];
  return parsed.binary.slice(view.byteOffset, view.byteOffset + accessor.count * 4);
}

function indices(parsed: Parsed, index: number): Uint32Array {
  const accessor = parsed.document.accessors[index] as Accessor;
  const view = parsed.document.bufferViews[
    accessor.bufferView
  ] as Parsed['document']['bufferViews'][number];
  return new Uint32Array(
    parsed.binary.buffer.slice(view.byteOffset, view.byteOffset + accessor.count * 4),
  );
}

function build(surface: Surface, zFactor = 1): Parsed {
  return parse(glbBytes(buildMesh(surface), LUT, zFactor, 'test'));
}

describe('GLB export', () => {
  it('writes the triangles with normals and colors of a surface', () => {
    const surface = grid(4, 5, (r, c) => (r * 5 + c) * 1e-9);
    surface.z[4] = NaN;
    const parsed = build(surface);
    const primitive = parsed.document.meshes[0]
      ?.primitives[0] as Parsed['document']['meshes'][number]['primitives'][number];
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
    const accessor = parsed.document.accessors[
      primitive.attributes.COLOR_0 as number
    ] as Accessor;
    expect(accessor.normalized).toBe(true);
    expect(accessor.type).toBe('VEC4');
  });

  it('stands the surface up at true scale and exaggerates the height on request', () => {
    const surface = grid(4, 6, (r, c) => (r * 6 + c) * 1e-9);
    const true_ = floats(build(surface), 0);
    const tall = floats(build(surface, 4), 0);
    for (let i = 0; i < true_.length; i += 3) {
      expect(tall[i + 1]).toBeCloseTo(4 * (true_[i + 1] as number), 6); // y is the height
      expect(tall[i]).toBe(true_[i]);
      expect(tall[i + 2]).toBe(true_[i + 2]);
    }
    const xs = Array.from(true_.filter((_, i) => i % 3 === 0));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 5); // the longest side is 1
  });

  it('gives a flat surface normals that point up', () => {
    const parsed = build(grid(3, 4, () => 1e-9));
    const normals = floats(
      parsed,
      parsed.document.meshes[0]?.primitives[0]?.attributes.NORMAL as number,
    );
    for (let i = 0; i < normals.length; i += 3) {
      expect(normals[i]).toBeCloseTo(0, 6);
      expect(normals[i + 1]).toBeCloseTo(1, 6);
      expect(normals[i + 2]).toBeCloseTo(0, 6);
    }
  });

  it('colors the lowest and the highest point with the ends of the color table, as linear values', () => {
    const parsed = build(grid(4, 5, (r, c) => (r * 5 + c) * 1e-9));
    const attributes = parsed.document.meshes[0]?.primitives[0]?.attributes as Record<
      string,
      number
    >;
    const heights = floats(parsed, attributes.POSITION as number).filter(
      (_, i) => i % 3 === 1,
    );
    const colors = bytesOf(parsed, attributes.COLOR_0 as number);
    const linear = (value: number): number => {
      const f = value / 255;
      return Math.round(
        (f <= 0.04045 ? f / 12.92 : ((f + 0.055) / 1.055) ** 2.4) * 255,
      );
    };
    const low = heights.indexOf(Math.min(...heights));
    const high = heights.indexOf(Math.max(...heights));
    expect(Array.from(colors.subarray(low * 4, low * 4 + 3))).toEqual(
      Array.from(LUT.subarray(0, 3), linear),
    );
    expect(Array.from(colors.subarray(high * 4, high * 4 + 3))).toEqual(
      Array.from(LUT.subarray(765, 768), linear),
    );
  });

  it('writes a point cloud as points', () => {
    const x = Float32Array.from([0, 1e-6, 2e-6, 3e-6]);
    const cloud: Surface = {
      kind: 'cloud',
      columns: 4,
      rows: 1,
      stepX: 0,
      stepY: 0,
      z: Float32Array.from([0, 1e-6, 0, 2e-6]),
      x,
      y: Float32Array.from([0, 2e-6, 1e-6, 0]),
    };
    const parsed = build(cloud);
    const primitive = parsed.document.meshes[0]
      ?.primitives[0] as Parsed['document']['meshes'][number]['primitives'][number];
    expect(primitive.mode).toBe(0);
    expect(primitive.indices).toBeUndefined();
    expect(primitive.attributes.NORMAL).toBeUndefined();
    expect(floats(parsed, 0).length).toBe(12);
  });

  it('keeps the real size in the asset', () => {
    const extras = build(grid(4, 6, () => 0, 2e-6)).document.asset.extras;
    expect(extras.extent_meters).toEqual([
      expect.closeTo(10e-6, 12),
      expect.closeTo(6e-6, 12),
    ]);
    expect(extras.scale_meters).toBeCloseTo(10e-6, 12);
    expect(extras.z_factor).toBe(1);
  });

  it('refuses a surface without measured points', () => {
    const empty = grid(2, 2, () => NaN);
    expect(() => glbBytes(buildMesh(empty), LUT, 1, 'test')).toThrow('measured');
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
      const report = await validateBytes(glbBytes(buildMesh(data), LUT, 2, 'test'));
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
  colors: number[];
  extentMeters: number[];
  indices?: number;
  indexSum?: number;
  normals?: number[];
}

const wanted = JSON.parse(
  readFileSync(join(process.cwd(), 'test', 'expected-glb.json'), 'utf-8'),
) as Record<string, Want>;

describe('GLB export of the sample files', () => {
  for (const [name, want] of Object.entries(wanted)) {
    it(`matches what sdflens writes for ${name}`, () => {
      const data = new Uint8Array(
        readFileSync(join(process.cwd(), 'test', 'samples', name)),
      );
      const surface = readFile(data, name).layer(0);
      expect(canExportModel(surface)).toBe(true);
      const parsed = parse(glbBytes(buildMesh(surface), LUT, 7.5, 'test'));
      const primitive = parsed.document.meshes[0]
        ?.primitives[0] as Parsed['document']['meshes'][number]['primitives'][number];
      const positions = floats(parsed, primitive.attributes.POSITION as number);
      expect(primitive.mode).toBe(want.mode);
      expect(positions.length / 3).toBe(want.vertices);
      // The heights of the page are float32, so the sums agree to about seven digits.
      const sums = (values: Float32Array): number[] => {
        const out = [0, 0, 0];
        for (let i = 0; i < values.length; i++)
          out[i % 3] = (out[i % 3] as number) + (values[i] as number);
        return out;
      };
      const close = (got: number[], expectedSums: number[], scale: number): void => {
        got.forEach((value, i) => {
          expect(Math.abs(value - (expectedSums[i] as number))).toBeLessThanOrEqual(
            1e-4 * scale + 1e-6,
          );
        });
      };
      close(sums(positions), want.positions, want.vertices);
      const extras = parsed.document.asset.extras.extent_meters as number[];
      expect(extras[0]).toBeCloseTo(want.extentMeters[0] as number, 9);
      expect(extras[1]).toBeCloseTo(want.extentMeters[1] as number, 9);
      const colors = bytesOf(parsed, primitive.attributes.COLOR_0 as number);
      const colorSums = [0, 0, 0, 0];
      colors.forEach((value, i) => {
        colorSums[i % 4] = (colorSums[i % 4] as number) + value;
      });
      colorSums.forEach((value, i) => {
        // A height that falls on the edge of two entries of the table may take the other one.
        expect(Math.abs(value - (want.colors[i] as number))).toBeLessThanOrEqual(
          0.005 * (want.colors[i] as number) + 255,
        );
      });
      if (primitive.indices !== undefined) {
        const triangles = indices(parsed, primitive.indices);
        expect(triangles.length).toBe(want.indices);
        expect(triangles.reduce((total, value) => total + value, 0)).toBe(
          want.indexSum,
        );
        const normals = floats(parsed, primitive.attributes.NORMAL as number);
        close(sums(normals), want.normals as number[], want.vertices);
      }
    });
  }
});
