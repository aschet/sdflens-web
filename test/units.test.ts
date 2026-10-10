// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { buildLut, colormapNames } from "../src/colormap";
import { formatLength, formatTick, niceTicks, unitFor } from "../src/units";

describe("units", () => {
  it("formats lengths with an SI prefix", () => {
    expect(formatLength(1.5e-6)).toBe("1.5 µm");
    expect(formatLength(13e-9)).toBe("13 nm");
    expect(formatLength(0)).toBe("0 m");
    expect(formatLength(NaN)).toBe("n/a");
    expect(unitFor(2.5e-6)).toEqual([1e-6, "µm"]);
  });

  it("formats ticks without floating point noise", () => {
    expect(formatTick(3e-7, 1e-9)).toBe("300");
  });

  it("chooses nice ticks", () => {
    expect(niceTicks(0, 1, 6).map((tick) => Number(tick.toFixed(9)))).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(1, 1)).toEqual([1]);
  });
});

describe("colormaps", () => {
  it("builds tables of 256 colors", () => {
    for (const name of colormapNames()) expect(buildLut(name).length).toBe(768);
    expect([...buildLut("Grayscale", true).slice(0, 3)]).toEqual([255, 255, 255]);
    expect([...buildLut("Viridis").slice(0, 3)]).toEqual([68, 1, 84]);
  });
});
