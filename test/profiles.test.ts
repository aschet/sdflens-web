// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  alongAxis,
  canRun,
  middleProfile,
  profileReadout,
  profileSeries,
  startAxis,
} from '../src/profiles';
import {
  clampFactor,
  factorFromSlider,
  factorText,
  sliderFromFactor,
} from '../src/zscale';
import { grid, unevenProfile } from './helpers';

describe('profiles', () => {
  const surface = grid(3, 4); // heights 0..11, row by row

  it('starts along x, or along y for a single column, in the middle', () => {
    expect(startAxis(surface)).toBe('x');
    expect(startAxis(grid(5, 1))).toBe('y');
    expect(middleProfile(surface, 'x')).toBe(1);
    expect(middleProfile(surface, 'y')).toBe(2);
  });

  it('takes a row or a column of the surface', () => {
    expect(Array.from(profileSeries(surface, 'x', 1).values)).toEqual([4, 5, 6, 7]);
    expect(Array.from(profileSeries(surface, 'y', 2).values)).toEqual([2, 6, 10]);
    expect(profileSeries(surface, 'x', 0)).toMatchObject({
      step: 1e-6,
      count: 3,
      positions: null,
    });
    expect(profileSeries(surface, 'y', 0)).toMatchObject({ count: 4 });
    // An index beyond the end is the last profile
    expect(Array.from(profileSeries(surface, 'x', 99).values)).toEqual([8, 9, 10, 11]);
  });

  it('does not copy a row of a long profile', () => {
    const { values } = profileSeries(surface, 'x', 1);
    expect(values.buffer).toBe(surface.z.buffer);
  });

  it('gives an irregular profile its positions and the mean spacing', () => {
    const series = profileSeries(unevenProfile([0, 1, 3, 8]), 'x', 0);
    expect(Array.from(series.positions as Float32Array)).toEqual([0, 1, 3, 8]);
    expect(series).toMatchObject({ count: 1, step: 8 / 3 });
    expect(alongAxis(unevenProfile([0, 1, 3]), 'y')).toBe('x');
    expect(alongAxis(surface, 'y')).toBe('y');
  });

  it('can run along an axis only if there is more than one point along it', () => {
    expect([canRun(surface, 'x'), canRun(surface, 'y')]).toEqual([true, true]);
    expect([canRun(grid(1, 5), 'x'), canRun(grid(1, 5), 'y')]).toEqual([true, false]);
    expect([canRun(grid(5, 1), 'x'), canRun(grid(5, 1), 'y')]).toEqual([false, true]);
  });

  it('reads a point as its position and height', () => {
    expect(profileReadout('x', 2.5e-6, 4e-9)).toBe('x=2.5 µm, z=4 nm');
    expect(profileReadout('y', 0, Number.NaN)).toBe('y=0 m, z=not measured');
  });
});

describe('height scale', () => {
  it('maps the slider to the factor and back, on a logarithmic scale', () => {
    expect(factorFromSlider(0)).toBeCloseTo(0.01, 12);
    expect(factorFromSlider(1000)).toBeCloseTo(10000, 6);
    // The slider has 1000 positions, so the factor comes back to within half a position: 0.003 decades.
    for (const factor of [0.05, 2, 37, 2500]) {
      const back = factorFromSlider(sliderFromFactor(factor));
      expect(Math.abs(Math.log10(back / factor))).toBeLessThan(0.0031);
    }
  });

  it('snaps to the true scale and keeps the factor within its limits', () => {
    expect(factorFromSlider(sliderFromFactor(1) + 3)).toBe(1);
    expect(factorFromSlider(sliderFromFactor(1.5))).not.toBe(1);
    expect([
      clampFactor(1e9),
      clampFactor(1e-9),
      clampFactor(Number.NaN),
      clampFactor(7),
    ]).toEqual([10000, 0.01, 1, 7]);
    expect(factorText(2.5)).toBe('×2.5');
    expect(factorText(1234.567)).toBe('×1230');
  });
});
