// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFile } from '../src/formats';
import { strToU8, zipSync } from 'fflate';
import { FormatError, irregularProfile, statistics } from '../src/model';

interface Expected {
  kind: 'grid' | 'cloud';
  layers: number;
  columns: number;
  rows: number;
  stepX?: number;
  stepY?: number;
  min: number;
  max: number;
  mean: number;
  invalid: number;
}

const expected = JSON.parse(
  readFileSync(join(process.cwd(), 'test', 'expected.json'), 'utf-8'),
) as Record<string, Expected>;

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), 'test', 'samples', name)));
}

describe('sample files', () => {
  for (const [name, want] of Object.entries(expected)) {
    it(`reads ${name} as sdfio and x3pio do`, () => {
      const file = readFile(load(name), name);
      expect(file.layerCount).toBe(want.layers);
      const surface = file.layer(0);
      expect(surface.kind).toBe(want.kind);
      expect(surface.columns).toBe(want.columns);
      expect(surface.rows).toBe(want.rows);
      if (want.stepX !== undefined) {
        expect(surface.stepX).toBeCloseTo(want.stepX, 15);
        expect(surface.stepY).toBeCloseTo(want.stepY as number, 15);
      }
      const stats = statistics(surface);
      expect(stats.invalid).toBe(want.invalid);
      // The heights are float32, which has about seven digits.
      const tolerance = 1e-6 * Math.max(Math.abs(want.min), Math.abs(want.max));
      expect(Math.abs(stats.min - want.min)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(stats.max - want.max)).toBeLessThanOrEqual(tolerance);
      let sum = 0;
      for (const value of surface.z) if (Number.isFinite(value)) sum += value;
      expect(Math.abs(sum / stats.measured - want.mean)).toBeLessThanOrEqual(tolerance);
    });
  }
});

describe('layers and positions', () => {
  it('decodes every layer of a file', () => {
    const file = readFile(load('x3pio_surface_layers_binary.x3p'), 'layers.x3p');
    expect(file.layerCount).toBe(3);
    const [first, last] = [file.layer(0), file.layer(2)];
    expect(first.z).not.toEqual(last.z);
  });

  it('gives the positions of an irregular surface and of a point cloud', () => {
    const irregular = readFile(
      load('x3pio_surface_irregular_binary.x3p'),
      'irregular.x3p',
    ).layer(0);
    expect(irregular.x).not.toBeNull();
    expect(irregular.y?.length).toBe(irregular.columns * irregular.rows);
    const cloud = readFile(load('x3pio_point_cloud_binary.x3p'), 'cloud.x3p').layer(0);
    expect(cloud.x?.length).toBe(1000);
  });

  it('plots a profile on its real positions, or on its step if the positions are not usable', () => {
    const irregular = readFile(
      load('x3pio_profile_irregular_binary.x3p'),
      'irregular.x3p',
    ).layer(0);
    expect(irregularProfile(irregular)).toMatchObject({ axis: 'x' });
    expect(Array.from(irregular.x as Float32Array, (v) => Math.round(v * 1e7))).toEqual(
      [0, 10, 30, 40, 80, 95, 120],
    );

    // A profile as OpenGPS wrote some: the lateral axis that is absolute holds numbers that are not positions.
    const axis = (type: string, increment: string): string =>
      `<AxisType>${type}</AxisType><DataType>D</DataType><Increment>${increment}</Increment><Offset>0</Offset>`;
    const incremental = axis('I', '1e-6');
    const absolute = axis('A', '1');
    const profile = (cx: string, cy: string, data: string[]): Uint8Array => {
      const xml =
        `<?xml version="1.0"?><ISO5436_2><Record1><Revision>ISO5436 - 2000</Revision><FeatureType>PRF</FeatureType><Axes>` +
        `<CX>${cx}</CX><CY>${cy}</CY><CZ>${absolute}</CZ></Axes></Record1>` +
        `<Record3><MatrixDimension><SizeX>4</SizeX><SizeY>1</SizeY><SizeZ>1</SizeZ></MatrixDimension>` +
        `<DataList>${data.map((d) => `<Datum>${d}</Datum>`).join('')}</DataList></Record3></ISO5436_2>`;
      return zipSync({ 'main.xml': strToU8(xml) });
    };
    const junk = ['1e-4;1e-7', '-9e303;2e-7', '8e30;3e-7', '5e-300;4e-7'];
    // Garbage across the profile does not matter.
    const across = readFile(profile(incremental, absolute, junk), 'a.x3p').layer(0);
    expect(across.x).toBeNull();
    expect(across.stepX).toBeCloseTo(1e-6, 15);
    expect(across.stepAssumed).toBeUndefined();
    // Positions across it that are valid and vary, as for a profile along a diagonal, are kept.
    const diagonal = readFile(
      profile(incremental, absolute, ['0;1e-7', '1e-6;2e-7', '2e-6;3e-7', '3e-6;4e-7']),
      'd.x3p',
    ).layer(0);
    expect(irregularProfile(diagonal)).toMatchObject({ axis: 'x' });
    expect(diagonal.x?.[3]).toBeCloseTo(3e-6, 12);
    expect(diagonal.y?.[3]).toBeCloseTo(3e-6, 12);
    // Its positions are the lengths along the path, which starts at 0.
    const lengths = irregularProfile(diagonal)?.positions;
    expect(lengths?.[0]).toBe(0);
    expect(lengths?.[3]).toBeCloseTo(3e-6 * Math.SQRT2, 12);
    // Garbage along it falls back to the step of the other axis, and says so.
    const along = readFile(profile(absolute, incremental, junk), 'b.x3p');
    expect(along.layer(0)).toMatchObject({ x: null, stepAssumed: true });
    expect(along.info[1]?.rows).toContainEqual(['Step', '1 µm, assumed']);
    // Even positions along an absolute axis are a regular profile.
    const even = readFile(
      profile(absolute, absolute, [
        '0;0;1e-7',
        '2e-6;0;2e-7',
        '4e-6;0;3e-7',
        '6e-6;0;4e-7',
      ]),
      'c.x3p',
    ).layer(0);
    expect(even.x).toBeNull();
    expect(even.stepX).toBeCloseTo(2e-6, 12);
  });

  it('lets the declared type decide whether data of one row is a profile', () => {
    const axis = (type: string, increment: string): string =>
      `<AxisType>${type}</AxisType><DataType>D</DataType><Increment>${increment}</Increment><Offset>0</Offset>`;
    // Uneven positions along x: not on a regular grid.
    const file = (feature: string | null, rows = 1): Uint8Array => {
      const data = [0, 1e-6, 3e-6, 4e-6].map((v) => `<Datum>${v};${v / 10}</Datum>`);
      const xml =
        `<?xml version="1.0"?><ISO5436_2><Record1><Revision>ISO5436 - 2000</Revision>` +
        (feature === null ? '' : `<FeatureType>${feature}</FeatureType>`) +
        `<Axes><CX>${axis('A', '1')}</CX><CY>${axis('I', '1e-6')}</CY><CZ>${axis('A', '1')}</CZ></Axes></Record1>` +
        `<Record3><MatrixDimension><SizeX>${4 / rows}</SizeX><SizeY>${rows}</SizeY><SizeZ>1</SizeZ></MatrixDimension>` +
        `<DataList>${data.join('')}</DataList></Record3></ISO5436_2>`;
      return zipSync({ 'main.xml': strToU8(xml) });
    };
    const layer = (
      feature: string | null,
      rows = 1,
    ): ReturnType<typeof irregularProfile> =>
      irregularProfile(readFile(file(feature, rows), 'p.x3p').layer(0));

    expect(layer('PRF')).toMatchObject({ axis: 'x' });
    // A surface of one row is a surface, however irregular its points are.
    expect(layer('SUR')).toBeNull();
    // A file without a type is judged by its shape.
    expect(layer(null)).toMatchObject({ axis: 'x' });
    // A profile has a single row: with more it is a surface.
    expect(layer('PRF', 2)).toBeNull();
    expect(() => readFile(file('XYZ'), 'p.x3p')).toThrow(/Unknown FeatureType XYZ/);
    expect(readFile(file('PRF'), 'p.x3p').info[0]?.rows).toContainEqual([
      'Feature',
      'Profile',
    ]);
    expect(readFile(file('SUR'), 'p.x3p').info[0]?.rows).toContainEqual([
      'Feature',
      'Surface',
    ]);
  });

  it('reads the two revisions of the standard and refuses another one', () => {
    const axis = (type: string): string =>
      `<AxisType>${type}</AxisType><DataType>D</DataType><Increment>1e-6</Increment><Offset>0</Offset>`;
    const file = (revision: string | null): Uint8Array =>
      zipSync({
        'main.xml': strToU8(
          `<?xml version="1.0"?><ISO5436_2><Record1>` +
            (revision === null ? '' : `<Revision>${revision}</Revision>`) +
            `<FeatureType>PRF</FeatureType><Axes><CX>${axis('I')}</CX><CY>${axis('I')}</CY><CZ>${axis('A')}</CZ></Axes></Record1>` +
            `<Record3><MatrixDimension><SizeX>2</SizeX><SizeY>1</SizeY><SizeZ>1</SizeZ></MatrixDimension>` +
            `<DataList><Datum>1e-7</Datum><Datum>2e-7</Datum></DataList></Record3></ISO5436_2>`,
        ),
      });
    const shown = (revision: string | null): unknown =>
      readFile(file(revision), 'r.x3p').info[0]?.rows.find(
        ([label]) => label === 'Revision',
      )?.[1];

    expect(shown('ISO25178-72:2017/DAM1')).toBe('ISO25178-72:2017/DAM1');
    expect(shown('ISO5436 - 2000')).toBe('ISO5436 - 2000');
    // Some software writes another dash than the hyphen.
    expect(shown('ISO5436 \u2013 2000')).toBe('ISO5436 - 2000');
    expect(shown(null)).toBe('not set');
    expect(() => readFile(file('future'), 'r.x3p')).toThrow(/Unknown revision future/);
    expect(() => readFile(file('ISO5436-2000'), 'r.x3p')).toThrow(FormatError);
  });

  it('puts the first row of a BCR file at y = 0 like the other revisions', () => {
    const bcr = readFile(load('bcr1_surface_binary.sdf'), 'bcr.sdf').layer(0);
    const iso = readFile(load('iso1_surface_binary.sdf'), 'iso.sdf').layer(0);
    const rowsWithGaps = (z: Float32Array, columns: number): number[] => {
      const rows = new Set<number>();
      z.forEach((value, i) => Number.isNaN(value) && rows.add(Math.floor(i / columns)));
      return [...rows].sort((a, b) => a - b);
    };
    expect(rowsWithGaps(bcr.z, bcr.columns)).toEqual(rowsWithGaps(iso.z, iso.columns));
  });
});

describe('errors', () => {
  it('rejects files that are neither SDF nor x3p', () => {
    expect(() => readFile(new TextEncoder().encode('hello'), 'x.txt')).toThrow(
      FormatError,
    );
  });

  it('rejects a truncated binary SDF file', () => {
    const bytes = load('iso1_surface_binary.sdf');
    expect(() => readFile(bytes.subarray(0, 200), 'short.sdf')).toThrow(FormatError);
  });

  it('rejects a zip archive without main.xml', () => {
    const zip = new Uint8Array([
      0x50,
      0x4b,
      0x05,
      0x06,
      ...new Array<number>(18).fill(0),
    ]);
    expect(() => readFile(zip, 'empty.x3p')).toThrow(FormatError);
  });
});
