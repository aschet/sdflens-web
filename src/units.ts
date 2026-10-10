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
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  const ticks: number[] = [];
  for (let k = first; k <= last; k++) ticks.push(k * step);
  return ticks;
}
