// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** The description of a file that SDF and x3p files share, so that the information panel reads the same for both. */

import type { InfoSection } from "../model";
import { formatLength } from "../units";

export type Feature = "Surface" | "Profile" | "Point cloud";

export interface Description {
  /** The format with its encoding, as in "SDF, binary" or "x3p, XML". */
  format: string;
  revision: string;
  feature: Feature;
  size: string;
  /** The distance between points of a regular grid. */
  step?: string;
  /** Says how the points of an irregular grid or of a cloud are positioned. */
  positions?: string;
  resolution?: string;
  placement?: string;
  /** The fields of the instrument; those that a format does not have, or that are not given, show as "-". */
  instrument: Partial<Record<InstrumentField, string>>;
  /** Where the data comes from; the entries without a value are left out. */
  source: [string, string | undefined][];
}

export const INSTRUMENT_FIELDS = ["Manufacturer", "Model", "Serial", "Version", "Probing type", "Probing identification", "Calibrated"] as const;
export type InstrumentField = (typeof INSTRUMENT_FIELDS)[number];

const PLACEHOLDER = /^(n\/a|not available|not set|none|unknown|-)?$/i;

/** Whether a text stands for a value that is not given. */
export function isPlaceholder(value: string | undefined): boolean {
  return value === undefined || PLACEHOLDER.test(value.trim());
}

/** A profile is a surface of a single row. */
export function featureOf(cloud: boolean, rows: number): Feature {
  return cloud ? "Point cloud" : rows === 1 ? "Profile" : "Surface";
}

export function sizeText(feature: Feature, columns: number, rows: number): string {
  const count = (value: number): string => value.toLocaleString("en");
  return feature === "Surface" ? `${count(columns)} × ${count(rows)} points` : `${count(columns)} points`;
}

export function stepText(feature: Feature, stepX: number, stepY: number): string {
  return feature === "Surface" ? `${formatLength(stepX)} × ${formatLength(stepY)}` : formatLength(stepX);
}

/** A date as "2026-01-01 12:00 UTC"; a text that is not a date, such as a placeholder, gives undefined. */
export function formatDate(text: string | undefined): string | undefined {
  if (isPlaceholder(text)) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?/.exec((text as string).trim());
  if (!m) return undefined;
  const zone = m[3];
  const suffix = zone === undefined ? "" : zone === "Z" || /^[+-]00(?::?00)?$/.test(zone) ? " UTC" : ` ${zone}`;
  return `${m[1]} ${m[2]}${suffix}`;
}

export function describeFile(d: Description): InfoSection[] {
  const file: InfoSection = {
    title: "File",
    rows: [
      ["Format", d.format],
      ["Revision", d.revision],
      ["Feature", d.feature],
    ],
  };
  const data: InfoSection = { title: "Data", rows: [["Size", d.size]] };
  if (d.step) data.rows.push(["Step", d.step]);
  if (d.positions) data.rows.push(["Positions", d.positions]);
  if (d.resolution) data.rows.push(["Height resolution", d.resolution]);
  if (d.placement) data.rows.push(["Placement", d.placement]);
  const instrument: InfoSection = {
    title: "Instrument",
    rows: INSTRUMENT_FIELDS.map((field): [string, string] => {
      const value = d.instrument[field];
      return [field, isPlaceholder(value) ? "-" : (value as string)];
    }),
  };
  const sections = [file, data, instrument];
  const source = d.source.filter((row): row is [string, string] => !isPlaceholder(row[1]));
  if (source.length) sections.push({ title: "Source", rows: source });
  return sections;
}
