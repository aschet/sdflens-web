// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** The height scale of the 3D view and the slider that sets it. */

export const Z_FACTOR_MIN = 0.01;
export const Z_FACTOR_MAX = 10000;
export const SLIDER_MAX = 1000;

const logMin = Math.log10(Z_FACTOR_MIN);
const logMax = Math.log10(Z_FACTOR_MAX);

/** The factor within its limits; a value that is not a number is the true scale. */
export function clampFactor(factor: number): number {
  return Math.min(
    Math.max(Number.isFinite(factor) ? factor : 1, Z_FACTOR_MIN),
    Z_FACTOR_MAX,
  );
}

/** The factor for a position of the slider, which runs along a logarithmic scale. */
export function factorFromSlider(position: number): number {
  const factor = 10 ** (logMin + (position / SLIDER_MAX) * (logMax - logMin));
  // Close to the true scale the slider snaps to 1, so that it is easy to return to.
  return Math.abs(Math.log10(factor)) < 0.03 ? 1 : factor;
}

export function sliderFromFactor(factor: number): number {
  return Math.round(((Math.log10(factor) - logMin) / (logMax - logMin)) * SLIDER_MAX);
}

/** The factor as shown next to the slider, as in "×2.5". */
export function factorText(factor: number): string {
  return `×${Number(factor.toPrecision(3))}`;
}
