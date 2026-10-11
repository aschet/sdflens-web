// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { Viewport2D } from '../src/render/viewport';

const MARGINS = { left: 50, top: 10, right: 10, bottom: 30 };

/** A viewport on 100 x 50 points of 1 µm in a canvas of 460 x 190 pixels, a plot of 400 x 150. */
function viewport(): Viewport2D {
  const view = new Viewport2D(MARGINS);
  view.setGrid({ columns: 100, rows: 50, stepX: 1e-6, stepY: 1e-6 });
  view.resize(460, 190);
  return view;
}

describe('2D viewport', () => {
  it('fits the data into the plot, centered', () => {
    const view = viewport();
    // 100 µm across 400 pixels is 4 pixels per µm, but 50 µm across 150 is 3: the height limits
    expect(view.scale).toBeCloseTo(3e6, 0);
    const box = view.dataBox();
    expect(box.height).toBeCloseTo(150, 6);
    expect(box.width).toBeCloseTo(300, 6);
    expect(box.left).toBeCloseTo(MARGINS.left + 50, 6);
  });

  it('converts between the canvas and the world, both ways', () => {
    const view = viewport();
    const [sx, sy] = view.toScreen(20e-6, 10e-6);
    const [wx, wy] = view.toWorld(sx, sy);
    expect([wx, wy]).toEqual([expect.closeTo(20e-6, 12), expect.closeTo(10e-6, 12)]);
    // y grows upwards in the world and downwards on the canvas
    expect(view.toScreen(0, 20e-6)[1]).toBeLessThan(view.toScreen(0, 10e-6)[1]);
  });

  it('zooms about a point, which stays where it is', () => {
    const view = viewport();
    const before = view.toWorld(MARGINS.left + 200, MARGINS.top + 75);
    view.zoomAt(2, 200, 75);
    const after = view.toWorld(MARGINS.left + 200, MARGINS.top + 75);
    expect(after[0]).toBeCloseTo(before[0], 12);
    expect(after[1]).toBeCloseTo(before[1], 12);
    expect(view.scale).toBeCloseTo(6e6, 0);
    expect(view.fitted).toBe(false);
  });

  it('limits the zoom: half the fitting scale out, 400 pixels per step in', () => {
    const view = viewport();
    const fit = view.fitScale();
    view.zoomAt(1e-6, 0, 0);
    expect(view.scale).toBeCloseTo(0.5 * fit, 6);
    view.zoomAt(1e9, 0, 0);
    expect(view.scale).toBeCloseTo(400 / 1e-6, 0);
  });

  it('pans, and goes home to the fitting view', () => {
    const view = viewport();
    const [x0, y1] = [view.x0, view.y1];
    view.panBy(30, -15);
    expect(view.x0).toBeCloseTo(x0 - 30 / view.scale, 12);
    expect(view.y1).toBeCloseTo(y1 - 15 / view.scale, 12);
    view.home();
    expect([view.x0, view.y1, view.fitted]).toEqual([x0, y1, true]);
  });

  it('keeps the fit when it is resized, but not a view that was moved', () => {
    const view = viewport();
    view.resize(260, 190);
    expect(view.dataBox().width).toBeCloseTo(200, 6);
    view.panBy(5, 5);
    const scale = view.scale;
    view.resize(460, 190);
    expect(view.scale).toBe(scale);
  });

  it('tells which part of the data is in the plot', () => {
    const view = viewport();
    const whole = view.visible();
    expect(whole.x[0]).toBeCloseTo(-0.5e-6, 12);
    expect(whole.y[1]).toBeCloseTo(49.5e-6, 12);
    view.zoomAt(4, 0, 0);
    const part = view.visible();
    expect(part.x[1] - part.x[0]).toBeLessThan(whole.x[1] - whole.x[0]);
    // zoomed in on the top left, the plot shows only the top left of the data
    expect(part.y[1]).toBeCloseTo(whole.y[1], 9);
  });
});
