// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { captionText, mapSize } from '../src/ui/locator';

const shape = (columns: number, rows: number, stepX = 1e-6, stepY = 1e-6) => ({
  columns,
  rows,
  stepX,
  stepY,
});

describe('overview map', () => {
  it('fits the aspect ratio of the surface into the box', () => {
    expect(mapSize(shape(400, 300), false)).toEqual({ width: 160, height: 120 });
    expect(mapSize(shape(100, 100), false)).toEqual({ width: 120, height: 120 });
    expect(mapSize(shape(400, 300), true)).toEqual({ width: 112, height: 84 });
  });

  it('takes the steps into account', () => {
    // 400 x 72 points of 5 µm by 500 µm: 2 mm by 36 mm
    const size = mapSize(shape(400, 72, 5e-6, 500e-6), false);
    expect(size.height).toBeGreaterThan(size.width);
  });

  it('shows a very long surface at most four times as long as wide', () => {
    expect(mapSize(shape(400, 72, 5e-6, 5e-3), false)).toEqual({
      width: 30,
      height: 120,
    });
    expect(mapSize(shape(5000, 10), false)).toEqual({ width: 160, height: 40 });
  });

  it('says where the profile lies: y for a row, x for a column', () => {
    const steps = { stepX: 2e-6, stepY: 3e-6 };
    expect(captionText(steps, 'x', 10)).toBe('y=30 µm');
    expect(captionText(steps, 'y', 10)).toBe('x=20 µm');
  });
});
