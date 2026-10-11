// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ProfileViewport } from '../src/render/profileViewport';

/** 101 points 1 µm apart in a plot of 500 pixels. */
function regular(): ProfileViewport {
  const view = new ProfileViewport();
  view.setPlotWidth(500);
  view.setSeries(101, 1e-6, null);
  return view;
}

describe('profile viewport, regular', () => {
  it('shows the whole profile, each point centered on its position', () => {
    const view = regular();
    const [low, high] = view.full();
    expect([low, high]).toEqual([
      expect.closeTo(-0.5e-6, 12),
      expect.closeTo(100.5e-6, 12),
    ]);
    expect([view.x0, view.span]).toEqual([
      expect.closeTo(-0.5e-6, 12),
      expect.closeTo(101e-6, 12),
    ]);
    expect(view.visible()).toMatchObject({ start: 0, stop: 101 });
    // 101 points in 500 pixels: a pixel holds fewer than one point
    expect(view.visible().perPixel).toBeCloseTo(101 / 500, 12);
  });

  it('keeps the zoom for a profile like the one before, and resets it for another', () => {
    const view = regular();
    view.zoomAt(4, 0);
    const span = view.span;
    expect(view.setSeries(101, 1e-6, null)).toBe(false);
    expect(view.span).toBe(span);
    expect(view.setSeries(101, 2e-6, null)).toBe(true);
    expect(view.span).toBeCloseTo(202e-6, 12);
  });

  it('zooms about a pixel, which keeps its position, and limits the zoom in to three points', () => {
    const view = regular();
    const before = view.positionAtPixel(250);
    view.zoomAt(2, 250);
    expect(view.positionAtPixel(250)).toBeCloseTo(before, 12);
    expect(view.span).toBeCloseTo(50.5e-6, 12);
    view.zoomAt(1e9, 250);
    expect(view.span).toBeCloseTo(3e-6, 12);
    view.zoomAt(1e-9, 250);
    expect(view.span).toBeCloseTo(101e-6, 12);
  });

  it('pans, but not beyond the ends of the profile', () => {
    const view = regular();
    view.zoomAt(4, 0);
    // dragging to the right shows what lies to the left
    view.panBy(100000);
    expect(view.x0).toBeCloseTo(-0.5e-6, 12);
    view.panBy(-100000);
    expect(view.x0 + view.span).toBeCloseTo(100.5e-6, 12);
  });

  it('tells the visible points and the point nearest to a position', () => {
    const view = regular();
    view.zoomAt(4, 0); // the points from -0.5 µm to 24.75 µm
    expect(view.visible()).toMatchObject({ start: 0, stop: 25 });
    expect(view.indexAt(7.4e-6)).toBe(7);
    expect(view.indexAt(7.6e-6)).toBe(8);
    expect(view.indexAt(-3e-6)).toBe(-1);
    expect(view.indexAt(200e-6)).toBe(-1);
    expect(view.pixelAt(view.positionAtPixel(123))).toBeCloseTo(123, 9);
  });
});

describe('profile viewport, irregular', () => {
  const positions = Float32Array.from([0, 1e-6, 3e-6, 4e-6, 8e-6, 9.5e-6, 12e-6]);
  const view = new ProfileViewport();
  view.setPlotWidth(700);
  view.setSeries(positions.length, 12e-6 / 6, positions);

  it('spans from the first to the last position, padded by half a mean step', () => {
    const [low, high] = view.full();
    expect(low).toBeCloseTo(-1e-6, 12);
    expect(high).toBeCloseTo(13e-6, 12);
    expect(view.positionAt(2)).toBeCloseTo(3e-6, 12);
  });

  it('finds the visible points by their positions, with the neighbours of the first and the last', () => {
    view.home();
    view.zoomAt(2.2, 350); // from 2.8 µm to 9.2 µm: the points at 3, 4, 8 and 9.5 µm are at or near it
    const { start, stop } = view.visible();
    expect([start, stop]).toEqual([1, 6]);
  });

  it('finds the nearest point, also in the padding at the ends', () => {
    view.home();
    expect(view.indexAt(3.4e-6)).toBe(2);
    expect(view.indexAt(3.6e-6)).toBe(3);
    expect(view.indexAt(10.2e-6)).toBe(5);
    expect(view.indexAt(-0.4e-6)).toBe(0);
    expect(view.indexAt(12.4e-6)).toBe(6);
  });
});
