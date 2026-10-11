// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** SI unit prefixes, tick generation and number formatting for lengths in meters. */

const UNITS: [number, string][] = [
  [1e-12, "pm"],
  [1e-9, "nm"],
  [1e-6, "µm"],
  [1e-3, "mm"],
  [1e-2, "cm"],
  [1, "m"],
];

/** The factor and symbol of the largest SI length unit not exceeding ``magnitude``; meters if it is no length. */
export function unitFor(magnitude: number): [number, string] {
  if (!Number.isFinite(magnitude) || magnitude <= 0) return [1, "m"];
  let chosen = UNITS[0] as [number, string];
  for (const unit of UNITS) {
    if (magnitude >= unit[0] * 0.999) chosen = unit;
  }
  return chosen;
}

/** Formats a number with at most ``digits`` significant digits and without trailing zeros. */
function significant(value: number, digits: number): string {
  return String(Number(value.toPrecision(digits)));
}

/** Formats a length in meters with a suitable SI prefix, as in "1.5 µm". */
export function formatLength(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return "n/a";
  const [factor, symbol] = unitFor(Math.abs(value));
  return `${significant(value / factor, digits)} ${symbol}`;
}

/** Formats extents in meters as "399 × 299 × 4.4 µm", in one unit unless the smallest would be below a tenth of it. */
export function formatExtent(extents: number[], digits = 4): string {
  const largest = Math.max(...extents);
  const [factor, symbol] = unitFor(largest);
  if (extents.every((value) => value === 0 || value / factor >= 0.1)) {
    return `${extents.map((value) => significant(value / factor, digits)).join(" × ")} ${symbol}`;
  }
  return extents.map((value) => formatLength(value, digits)).join(" × ");
}

/** Formats ``value`` divided by the unit ``factor`` without floating point noise. */
export function formatTick(value: number, factor: number): string {
  return String(Number((value / factor).toPrecision(6)));
}

/** "Nice" tick positions, 1, 2 or 5 times a power of ten, within [lo, hi]. */
export function niceTicks(lo: number, hi: number, target = 6): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi < lo) [lo, hi] = [hi, lo];
  const span = hi - lo;
  if (span <= 0) return [lo];
  const raw = span / Math.max(target - 1, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  let step = magnitude * 10;
  for (const multiple of [1, 2, 5, 10]) {
    if (raw <= multiple * magnitude) {
      step = multiple * magnitude;
      break;
    }
  }
  let ticks = ticksAt(lo, hi, step);
  // An axis with a single tick says little: take finer steps until there are three.
  for (let i = 0; i < 4 && ticks.length < 3; i++) {
    step = smaller(step);
    ticks = ticksAt(lo, hi, step);
  }
  return ticks;
}

function ticksAt(lo: number, hi: number, step: number): number[] {
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  const ticks: number[] = [];
  for (let k = first; k <= last; k++) ticks.push(k * step || 0);
  return ticks;
}

/** The next smaller of the steps 1, 2 and 5 times a power of ten. */
function smaller(step: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(step) + 1e-9);
  const mantissa = Math.round(step / magnitude);
  return mantissa >= 5 ? 2 * magnitude : mantissa >= 2 ? magnitude : 5 * (magnitude / 10);
}
