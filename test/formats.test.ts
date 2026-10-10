// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFile } from "../src/formats";
import { FormatError, statistics } from "../src/model";

interface Expected {
  kind: "grid" | "cloud";
  layers: number;
  columns: number;
  rows: number;
  stepX?: number;
  stepY?: number;
  min: number;
  max: number;
  mean: number;
  invalid: number;
}

const expected = JSON.parse(readFileSync(join(process.cwd(), "test", "expected.json"), "utf-8")) as Record<string, Expected>;

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), "test", "samples", name)));
}

describe("sample files", () => {
  for (const [name, want] of Object.entries(expected)) {
    it(`reads ${name} as sdfio and x3pio do`, () => {
      const file = readFile(load(name), name);
      expect(file.layerCount).toBe(want.layers);
      const surface = file.layer(0);
      expect(surface.kind).toBe(want.kind);
      expect(surface.columns).toBe(want.columns);
      expect(surface.rows).toBe(want.rows);
      if (want.stepX !== undefined) {
        expect(surface.stepX).toBeCloseTo(want.stepX, 15);
        expect(surface.stepY).toBeCloseTo(want.stepY as number, 15);
      }
      const stats = statistics(surface);
      expect(stats.invalid).toBe(want.invalid);
      // The heights are float32, which has about seven digits.
      const tolerance = 1e-6 * Math.max(Math.abs(want.min), Math.abs(want.max));
      expect(Math.abs(stats.min - want.min)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(stats.max - want.max)).toBeLessThanOrEqual(tolerance);
      let sum = 0;
      for (const value of surface.z) if (Number.isFinite(value)) sum += value;
      expect(Math.abs(sum / stats.measured - want.mean)).toBeLessThanOrEqual(tolerance);
    });
  }
});

describe("layers and positions", () => {
  it("decodes every layer of a file", () => {
    const file = readFile(load("x3pio_surface_layers_binary.x3p"), "layers.x3p");
    expect(file.layerCount).toBe(3);
    const [first, last] = [file.layer(0), file.layer(2)];
    expect(first.z).not.toEqual(last.z);
  });

  it("gives the positions of an irregular surface and of a point cloud", () => {
    const irregular = readFile(load("x3pio_surface_irregular_binary.x3p"), "irregular.x3p").layer(0);
    expect(irregular.x).not.toBeNull();
    expect(irregular.y?.length).toBe(irregular.columns * irregular.rows);
    const cloud = readFile(load("x3pio_point_cloud_binary.x3p"), "cloud.x3p").layer(0);
    expect(cloud.x?.length).toBe(1000);
  });

  it("puts the first row of a BCR file at y = 0 like the other dialects", () => {
    const bcr = readFile(load("bcr1_surface_binary.sdf"), "bcr.sdf").layer(0);
    const iso = readFile(load("iso1_surface_binary.sdf"), "iso.sdf").layer(0);
    const rowsWithGaps = (z: Float32Array, columns: number): number[] => {
      const rows = new Set<number>();
      z.forEach((value, i) => Number.isNaN(value) && rows.add(Math.floor(i / columns)));
      return [...rows].sort((a, b) => a - b);
    };
    expect(rowsWithGaps(bcr.z, bcr.columns)).toEqual(rowsWithGaps(iso.z, iso.columns));
  });
});

describe("errors", () => {
  it("rejects files that are neither SDF nor x3p", () => {
    expect(() => readFile(new TextEncoder().encode("hello"), "x.txt")).toThrow(FormatError);
  });

  it("rejects a truncated binary SDF file", () => {
    const bytes = load("iso1_surface_binary.sdf");
    expect(() => readFile(bytes.subarray(0, 200), "short.sdf")).toThrow(FormatError);
  });

  it("rejects a zip archive without main.xml", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
    expect(() => readFile(zip, "empty.x3p")).toThrow(FormatError);
  });
});
