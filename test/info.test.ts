// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFile } from "../src/formats";
import { formatDate } from "../src/formats/info";

function info(name: string): Record<string, Record<string, string>> {
  const bytes = new Uint8Array(readFileSync(join(process.cwd(), "test", "samples", name)));
  const sections: Record<string, Record<string, string>> = {};
  for (const section of readFile(bytes, name).info) sections[section.title] = Object.fromEntries(section.rows);
  return sections;
}

describe("file information", () => {
  it("has the same sections for SDF and x3p, without the trailer and the metadata block", () => {
    for (const name of ["iso2_surface_binary.sdf", "x3pio_surface_binary.x3p", "bcr1_profile_ascii.sdf", "x3pio_point_cloud_binary.x3p"]) {
      const titles = Object.keys(info(name));
      expect(titles.slice(0, 3)).toEqual(["File", "Data", "Instrument"]);
      expect(titles.every((title) => ["File", "Data", "Instrument", "Source"].includes(title))).toBe(true);
    }
  });

  it("names the format with its encoding and the revision", () => {
    expect(info("iso2_surface_binary.sdf").File).toMatchObject({ Format: "SDF, binary", Revision: "ISO-2.0" });
    expect(info("iso2_surface_ascii.sdf").File).toMatchObject({ Format: "SDF, ASCII" });
    expect(info("iso1_surface_binary.sdf").File).toMatchObject({ Revision: "ISO-1.0" });
    expect(info("bcr1_surface_binary.sdf").File).toMatchObject({ Revision: "BCR-1.0" });
    // The revision is the identifier that the file states.
    expect(info("x3pio_surface_binary.x3p").File).toMatchObject({ Format: "x3p, binary", Revision: "ISO25178-72:2017/DAM1" });
    expect(info("x3pio_surface_xml.x3p").File).toMatchObject({ Format: "x3p, XML" });
  });

  it("names the feature, a single profile of an SDF file being a profile", () => {
    expect(info("iso1_profile_binary.sdf").File).toMatchObject({ Feature: "Profile" });
    expect(info("iso1_surface_binary.sdf").File).toMatchObject({ Feature: "Surface" });
    expect(info("x3pio_profile_binary.x3p").File).toMatchObject({ Feature: "Profile" });
    expect(info("x3pio_point_cloud_binary.x3p").File).toMatchObject({ Feature: "Point cloud" });
  });

  it("combines size and step, and does not repeat the layers, which have their own switch", () => {
    const surface = info("iso2_surface_binary.sdf");
    expect(surface.Data).toMatchObject({ Size: "48 × 32 points", Step: "2 µm × 3 µm" });
    expect(surface.File).not.toHaveProperty("Layers");
    expect(info("x3pio_surface_layers_binary.x3p").File).not.toHaveProperty("Layers");
    expect(info("iso1_profile_binary.sdf").Data).toMatchObject({ Size: "128 points", Step: "2 µm" });
    expect(info("x3pio_surface_irregular_binary.x3p").Data).toMatchObject({ Positions: "stored for every point" });
  });

  it("lists the fields of the instrument for both formats, with a dash for what a file does not give", () => {
    const fields = ["Manufacturer", "Model", "Serial", "Version", "Probing type", "Probing identification", "Calibrated"];
    const sdf = info("iso2_surface_binary.sdf").Instrument as Record<string, string>;
    expect(Object.keys(sdf)).toEqual(fields);
    expect(sdf).toMatchObject({ Manufacturer: "sdfio", Model: "-", Serial: "-", Calibrated: "-" });
    const x3p = info("x3pio_surface_binary.x3p").Instrument as Record<string, string>;
    expect(Object.keys(x3p)).toEqual(fields);
    expect(x3p).toMatchObject({ Manufacturer: "x3pio", Model: "tests/samples/generate.py", Serial: "-", Version: "1", "Probing type": "Software" });
  });

  it("shows the creation date in the file section for both formats, and who created it", () => {
    expect(info("iso2_surface_binary.sdf").File).toMatchObject({ Creation: "2026-01-01 12:00 UTC" });
    expect(info("x3pio_surface_binary.x3p").File).toMatchObject({ Creation: "2026-01-01 12:00 UTC" });
    expect(info("x3pio_surface_binary.x3p").Source).toMatchObject({ Creator: "x3pio sample generator" });
    // An SDF file has no creator or comment, so it has no such section, and the modification date is not shown.
    expect(info("iso2_surface_binary.sdf")).not.toHaveProperty("Source");
    expect(JSON.stringify(info("iso2_surface_binary.sdf"))).not.toContain("Modified");
  });

  it("formats dates and leaves out placeholders", () => {
    expect(formatDate("2024-05-01T10:00:00.0+02:00")).toBe("2024-05-01 10:00 +02:00");
    expect(formatDate("2024-05-01T10:00:00Z")).toBe("2024-05-01 10:00 UTC");
    expect(formatDate("2024-05-01 10:00:00")).toBe("2024-05-01 10:00");
    expect(formatDate("N/A")).toBeUndefined();
    expect(formatDate(undefined)).toBeUndefined();
  });
});
