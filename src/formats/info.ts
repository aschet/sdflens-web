// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** The description of a file that SDF and x3p files share, so that the information panel reads the same for both. */

import type { InfoSection } from "../model";
import { formatLength } from "../units";

export type Feature = "Surface" | "Profile" | "Point cloud";

export interface Description {
  /** The format with its encoding, as in "SDF binary" or "x3p XML". */
  format: string;
  revision: string;
  feature: Feature;
  /** Who created the data, and when; undefined if the file does not say. */
  creator?: string;
  creation?: string;
  size: string;
  /** The distance between points of a regular grid. */
  step?: string;
  /** Says how the points of an irregular grid or of a cloud are positioned. */
  positions?: string;
  /** The data type in which each axis is stored, if it is stored; the names are the same for every format. */
  types: { x?: string; y?: string; z?: string };
  resolution?: string;
  placement?: string;
  /** The fields of the instrument and of the probing system; those that a format does not have, or that are not given, show as "-". */
  instrument: Partial<Record<InstrumentField, string>>;
  probing: Partial<Record<ProbingField, string>>;
}

export const INSTRUMENT_FIELDS = ["Manufacturer", "Model", "Serial", "Version", "Calibration"] as const;
export type InstrumentField = (typeof INSTRUMENT_FIELDS)[number];
export const PROBING_FIELDS = ["Type", "Identification"] as const;
export type ProbingField = (typeof PROBING_FIELDS)[number];

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

const DATE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?/;

/**
 * A date written in the locale of the system and in its time zone. A date with a time zone, such as UTC, is
 * converted; a date without one is local time already and stays as it is. Text that is not a date, such as a
 * placeholder, gives undefined. A date that cannot be read is no reason to fail: it gives undefined as well.
 */
export function formatDate(text: string | undefined, locale?: string, timeZone?: string): string | undefined {
  if (isPlaceholder(text)) return undefined;
  const m = DATE.exec((text as string).trim());
  if (!m) return undefined;
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
  try {
    let date: Date;
    if (m[6] === undefined) {
      date = new Date(year, month - 1, day, hour, minute);
      // A day or a time that does not exist, such as the 30th of February, rolls over; it is not a date.
      if (date.getMonth() !== month - 1 || date.getDate() !== day || hour > 23 || minute > 59) return undefined;
    } else {
      const zone = m[6] === "Z" ? "Z" : /^[+-]\d{2}$/.test(m[6]) ? `${m[6]}:00` : m[6].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
      date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${zone}`);
    }
    if (Number.isNaN(date.getTime())) return undefined;
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
  } catch {
    return undefined;
  }
}

/** The information about a file is never worth failing to open it: if it cannot be built, there is none. */
export function safely(build: () => InfoSection[]): InfoSection[] {
  try {
    return build();
  } catch {
    return [];
  }
}

export function describeFile(d: Description): InfoSection[] {
  const file: InfoSection = {
    title: "File",
    rows: [
      ["Format", d.format],
      ["Revision", d.revision],
      ["Feature", d.feature],
      ["Creator", isPlaceholder(d.creator) ? "-" : (d.creator as string)],
      ["Creation", isPlaceholder(d.creation) ? "-" : (d.creation as string)],
    ],
  };
  const data: InfoSection = { title: "Data", rows: [["Size", d.size]] };
  if (d.step) data.rows.push(["Step", d.step]);
  if (d.positions) data.rows.push(["Positions", d.positions]);
  const given = (value: string | undefined): string => (isPlaceholder(value) ? "-" : (value as string));
  // In the order x, y, z.
  const types = (["x", "y", "z"] as const).map((axis) => given(d.types[axis]));
  data.rows.push(["Type", types.join(", ")]);
  if (d.resolution) data.rows.push(["Height resolution", d.resolution]);
  if (d.placement) data.rows.push(["Placement", d.placement]);
  const instrument: InfoSection = { title: "Instrument", rows: INSTRUMENT_FIELDS.map((field): [string, string] => [field, given(d.instrument[field])]) };
  const probing: InfoSection = { title: "Probing", rows: PROBING_FIELDS.map((field): [string, string] => [field, given(d.probing[field])]) };
  return [file, data, instrument, probing];
}
