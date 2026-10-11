// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { buildLut, colormapNames } from '../src/colormap';
import { minorDivisions, minorTicks, ticksFor } from '../src/render/axes';
import {
  formatLength,
  formatExtent,
  formatTick,
  niceTicks,
  unitFor,
} from '../src/units';

describe('units', () => {
  it('formats lengths with an SI prefix', () => {
    expect(formatLength(1.5e-6)).toBe('1.5 µm');
    expect(formatLength(13e-9)).toBe('13 nm');
    expect(formatExtent([399e-6, 299e-6, 4.4e-6])).toBe('399 × 299 × 4.4 µm');
    expect(formatExtent([399e-6, 12e-9])).toBe('399 µm × 12 nm');
    expect(formatLength(0)).toBe('0 m');
    expect(formatLength(NaN)).toBe('n/a');
    expect(unitFor(2.5e-6)).toEqual([1e-6, 'µm']);
  });

  it('formats ticks without floating point noise', () => {
    expect(formatTick(3e-7, 1e-9)).toBe('300');
  });

  it('chooses nice ticks', () => {
    expect(niceTicks(0, 1, 6).map((tick) => Number(tick.toFixed(9)))).toEqual([
      0, 0.2, 0.4, 0.6, 0.8, 1,
    ]);
    expect(niceTicks(1, 1)).toEqual([1]);
    // An axis does not get a single tick: 100 would be too coarse for this interval.
    expect(niceTicks(-0.4, 82, 2)).toEqual([0, 20, 40, 60, 80]);
  });
});

describe('colormaps', () => {
  it('builds tables of 256 colors', () => {
    for (const name of colormapNames()) expect(buildLut(name).length).toBe(768);
    expect([...buildLut('Grayscale', true).slice(0, 3)]).toEqual([255, 255, 255]);
    expect([...buildLut('Viridis').slice(0, 3)]).toEqual([68, 1, 84]);
  });
});

describe('axis ticks', () => {
  const axis = (
    lo: number,
    hi: number,
    pixels = 400,
  ): { lo: number; hi: number; toScreen: (v: number) => number; title: string } => ({
    lo,
    hi,
    toScreen: (v) => ((v - lo) / (hi - lo)) * pixels,
    title: 'x',
  });

  it('splits a major step of 1 or 5 into five and of 2 into four', () => {
    expect([
      minorDivisions(1),
      minorDivisions(5),
      minorDivisions(20),
      minorDivisions(0.02),
    ]).toEqual([5, 5, 4, 4]);
  });

  it('puts minor ticks between the major ones, not on them', () => {
    expect(minorTicks(0, 10, [0, 5, 10])).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
    expect(minorTicks(0, 10, [5])).toEqual([]);
  });

  it('gives an axis at least three major ticks and a tick about every given spacing', () => {
    expect(ticksFor(axis(-0.4, 82), 240, 90).major).toEqual([0, 20, 40, 60, 80]);
    expect(ticksFor(axis(0, 100), 400, 80).major).toHaveLength(6);
  });

  it('leaves out minor ticks that would be closer than 7 pixels', () => {
    expect(ticksFor(axis(0, 100), 400, 80).minor.length).toBeGreaterThan(0);
    expect(ticksFor(axis(0, 100000), 400, 80).minor.length).toBeGreaterThan(0);
    expect(ticksFor(axis(0, 100, 40), 40, 10).minor).toEqual([]);
  });
});
