// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { lateralRange, statistics } from '../src/model';
import {
  availableViews,
  effectiveTool,
  nextLayer,
  screenshotName,
  startView,
  statusText,
} from '../src/viewing';
import { cloud, grid, unevenProfile } from './helpers';

describe('views', () => {
  it('tells for each kind of surface which views fit', () => {
    expect(availableViews(null, null)).toEqual({
      '3d': 'No file',
      '2d': 'No file',
      profile: 'No file',
    });
    expect(availableViews(grid(3, 4), null)).toEqual({
      '3d': null,
      '2d': null,
      profile: null,
    });
    // A profile has no 2D view; an irregular profile only the profile view, and a cloud only 3D.
    expect(availableViews(grid(1, 4), null)['2d']).toMatch(/regular grid/);
    const uneven = availableViews(unevenProfile([0, 1, 3]), null);
    expect([uneven['2d'] === null, uneven.profile]).toEqual([false, null]);
    expect(availableViews(cloud(5), null).profile).toMatch(/profile/);
    expect(availableViews(grid(3, 4), 'No WebGL')['3d']).toBe('No WebGL');
  });

  it('opens a profile as a profile, and anything else in 3D if it can', () => {
    const start = (surface = grid(3, 4), webgl: string | null = null) =>
      startView(surface, availableViews(surface, webgl));
    expect(start()).toBe('3d');
    expect(start(grid(1, 4))).toBe('profile');
    expect(start(grid(4, 1))).toBe('profile');
    expect(start(grid(3, 4), 'No WebGL')).toBe('2d');
    expect(start(cloud(5), 'No WebGL')).toBe('profile');
  });

  it('pans instead of rotating outside of the 3D view', () => {
    expect(effectiveTool('3d', 'rotate')).toBe('rotate');
    expect(effectiveTool('2d', 'rotate')).toBe('pan');
    expect(effectiveTool('profile', 'zoom')).toBe('zoom');
  });
});

describe('status text', () => {
  const text = (surface: ReturnType<typeof grid>): string =>
    statusText(surface, statistics(surface), lateralRange(surface));

  it('gives the field of view of a grid as its points times the step', () => {
    expect(text(grid(30, 40, (r, c) => (r + c) * 1e-8))).toBe(
      'FOV 40 × 30 µm, PV 680 nm',
    );
  });

  it('leaves out the axis that a profile does not have', () => {
    expect(text(grid(1, 50))).toMatch(/^FOV 50 µm, PV /);
    expect(text(grid(50, 1))).toMatch(/^FOV 50 µm, PV /);
  });

  it('takes the span of the positions of an irregular profile or a cloud', () => {
    expect(text(unevenProfile([0, 1e-6, 3e-6, 4e-6]))).toMatch(/^FOV 4 µm, PV /);
    expect(text(cloud(11))).toMatch(/^FOV 10 × 10 µm, PV /);
  });
});

describe('layers and pictures', () => {
  it('steps through the layers and wraps around', () => {
    expect([
      nextLayer(0, 1, 3),
      nextLayer(2, 1, 3),
      nextLayer(0, -1, 3),
      nextLayer(1, -1, 3),
    ]).toEqual([1, 0, 2, 0]);
  });

  it('names the picture after the file and the view', () => {
    expect(screenshotName('surface.sdf', '3d')).toBe('surface-3d.png');
    expect(screenshotName('a.b.x3p', 'profile')).toBe('a.b-profile.png');
    expect(screenshotName('noextension', '2d')).toBe('noextension-2d.png');
  });
});
