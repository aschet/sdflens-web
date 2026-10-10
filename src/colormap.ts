// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { COLORMAP_TABLES } from "./colormapData";

export const LUT_SIZE = 256;
export const DEFAULT_COLORMAP = "Viridis";

export function colormapNames(): string[] {
  return [...Object.keys(COLORMAP_TABLES), "Grayscale"];
}

/** A table of 256 RGB triplets, 768 bytes, for the colormap ``name``. */
export function buildLut(name: string, reverse = false): Uint8Array {
  const lut = new Uint8Array(LUT_SIZE * 3);
  const table = COLORMAP_TABLES[name];
  if (table === undefined) {
    for (let i = 0; i < LUT_SIZE; i++) lut.fill(i, i * 3, i * 3 + 3);
  } else {
    for (let i = 0; i < lut.length; i++) lut[i] = parseInt(table.substr(i * 2, 2), 16);
  }
  if (!reverse) return lut;
  const reversed = new Uint8Array(lut.length);
  for (let i = 0; i < LUT_SIZE; i++) reversed.set(lut.subarray(i * 3, i * 3 + 3), (LUT_SIZE - 1 - i) * 3);
  return reversed;
}
