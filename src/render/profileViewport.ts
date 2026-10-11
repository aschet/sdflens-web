// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** The geometry of the profile view: which part of the profile is shown, and how it is panned and zoomed. */

/** The fewest points that the view can zoom in to. */
const MIN_POINTS = 3;

/** The first index whose position is not below ``target``, for positions in increasing order. */
export function lowerBound(positions: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = positions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((positions[mid] as number) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class ProfileViewport {
  /** The position along the profile at the left edge of the plot, and the length shown, in meters. */
  x0 = 0;
  span = 1;

  private count = 0;
  private step = 1;
  /** The positions of the points of an irregular profile, in increasing order, or null for a regular one. */
  private positions: Float32Array | null = null;
  private plotWidth = 1;

  setPlotWidth(width: number): void {
    this.plotWidth = Math.max(width, 1);
  }

  /**
   * Sets the profile: ``count`` points ``step`` meters apart, or at ``positions`` if it is irregular. A profile
   * like the one before keeps the zoom; the return value says whether the whole profile is shown again.
   */
  setSeries(count: number, step: number, positions: Float32Array | null): boolean {
    const same =
      count === this.count &&
      step === this.step &&
      (positions === null) === (this.positions === null);
    this.count = count;
    this.step = step;
    this.positions = positions;
    if (!same) this.home();
    return !same;
  }

  /** The position along the profile of a point. */
  positionAt(index: number): number {
    return this.positions ? (this.positions[index] as number) : index * this.step;
  }

  /** The interval of positions that covers all points, each centered on its position. */
  full(): [number, number] {
    if (this.positions && this.count > 1) {
      return [
        (this.positions[0] as number) - 0.5 * this.step,
        (this.positions[this.count - 1] as number) + 0.5 * this.step,
      ];
    }
    return [-0.5 * this.step, (Math.max(this.count, 1) - 0.5) * this.step];
  }

  home(): void {
    const [low, high] = this.full();
    this.x0 = low;
    this.span = high - low;
  }

  /** Zooms by ``factor`` about the pixel ``px`` of the plot, which keeps its position. */
  zoomAt(factor: number, px: number): void {
    const [low, high] = this.full();
    const anchor = this.x0 + (px / this.plotWidth) * this.span;
    const span = Math.min(
      Math.max(this.span / factor, Math.min(MIN_POINTS * this.step, high - low)),
      high - low,
    );
    this.x0 = Math.min(
      Math.max(anchor - (px / this.plotWidth) * span, low),
      high - span,
    );
    this.span = span;
  }

  /** Moves the profile by ``dx`` pixels, not beyond its ends. */
  panBy(dx: number): void {
    const [low, high] = this.full();
    const shift = (dx / this.plotWidth) * this.span;
    this.x0 = Math.min(Math.max(this.x0 - shift, low), high - this.span);
  }

  /** The pixel of the plot where ``position`` is. */
  pixelAt(position: number): number {
    return ((position - this.x0) / this.span) * this.plotWidth;
  }

  /**
   * The points that are shown: the indices from ``start`` up to ``stop``, which include the neighbours of the first
   * and the last visible point so that a line reaches the edge, and the number of points per pixel.
   */
  visible(): { start: number; stop: number; perPixel: number } {
    const xLo = this.x0;
    const xHi = this.x0 + this.span;
    if (this.positions) {
      const start = Math.max(0, lowerBound(this.positions, xLo) - 1);
      const stop = Math.min(this.count, lowerBound(this.positions, xHi) + 1);
      return { start, stop, perPixel: (stop - start) / this.plotWidth };
    }
    const first = xLo / this.step;
    const last = xHi / this.step;
    return {
      start: Math.max(0, Math.ceil(first)),
      stop: Math.min(this.count, Math.floor(last) + 1),
      perPixel: (last - first) / this.plotWidth,
    };
  }

  /** The index of the point nearest to ``position``, or -1 if the position is beyond the profile. */
  indexAt(position: number): number {
    if (this.positions) {
      const above = lowerBound(this.positions, position);
      const below = above - 1;
      const index =
        above >= this.count ||
        (below >= 0 &&
          position - (this.positions[below] as number) <=
            (this.positions[above] as number) - position)
          ? below
          : above;
      return index >= 0 && index < this.count ? index : -1;
    }
    const index = Math.round(position / this.step);
    return index >= 0 && index < this.count ? index : -1;
  }

  /** The position that the pixel ``px`` of the plot shows. */
  positionAtPixel(px: number): number {
    return this.x0 + (px / this.plotWidth) * this.span;
  }
}
