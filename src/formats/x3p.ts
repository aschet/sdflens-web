// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** Reader for ISO 25178-72 x3p files: surfaces, profiles and point clouds, in both revisions. */

import { unzipSync } from "fflate";
import { FormatError, type InfoSection, type Surface, type SurfaceFile } from "../model";
import { formatLength } from "../units";

interface Axis {
  absolute: boolean;
  type: string;
  increment: number;
}

interface FieldType {
  size: number;
  read(view: DataView, offset: number): number;
}

const TYPES: Record<string, FieldType> = {
  I: { size: 2, read: (view, offset) => view.getInt16(offset, true) },
  L: { size: 4, read: (view, offset) => view.getInt32(offset, true) },
  F: { size: 4, read: (view, offset) => view.getFloat32(offset, true) },
  D: { size: 8, read: (view, offset) => view.getFloat64(offset, true) },
};
const TYPE_NAMES: Record<string, string> = { I: "int16", L: "int32", F: "float32", D: "float64" };

type Files = Map<string, Uint8Array>;

/** Reads an x3p file. Throws a FormatError if it is not one, or is damaged. */
export function readX3p(bytes: Uint8Array, name: string): SurfaceFile {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new FormatError("Not an x3p file: it is not a zip archive");
  }
  const { files, prefix } = organize(entries);
  const mainBytes = files.get(prefix + "main.xml");
  if (!mainBytes) throw new FormatError("The file contains no main.xml");
  const doc = new DOMParser().parseFromString(new TextDecoder("utf-8").decode(mainBytes).replace(/^﻿/, ""), "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0 || !doc.documentElement) {
    throw new FormatError("main.xml is not valid XML");
  }
  const root = doc.documentElement;

  const record1 = need(root, "Record1");
  const record3 = need(root, "Record3");
  const axesElement = need(record1, "Axes");
  const [x, y, z] = ["CX", "CY", "CZ"].map((axis) => parseAxis(need(axesElement, axis), axis)) as [Axis, Axis, Axis];
  if (!z.absolute) throw new FormatError("The z axis must be an absolute axis");

  const matrix = child(record3, "MatrixDimension");
  const list = child(record3, "ListDimension");
  if (!matrix === !list) throw new FormatError("Record3 needs exactly one of MatrixDimension and ListDimension");
  let columns: number;
  let rows: number;
  let layers: number;
  if (matrix) {
    columns = count(need(matrix, "SizeX"));
    rows = count(need(matrix, "SizeY"));
    layers = count(need(matrix, "SizeZ"));
  } else {
    columns = count(list as Element);
    rows = 1;
    layers = 1;
  }
  const cloud = !matrix;
  const points = columns * rows;
  if (cloud && (!x.absolute || !y.absolute)) throw new FormatError("The axes of a point cloud must be absolute");

  // The coordinates of the absolute axes follow each other in one record per point.
  const absolute = ([["x", x], ["y", y], ["z", z]] as const).filter(([, axis]) => axis.absolute);
  const stride = absolute.reduce((sum, [, axis]) => sum + (TYPES[axis.type] as FieldType).size, 0);

  const link = child(record3, "DataLink");
  const dataList = child(record3, "DataList");
  if (!link === !dataList) throw new FormatError("Record3 needs exactly one of DataLink and DataList");

  let decode: (layer: number) => Map<string, Float32Array>;
  if (link) {
    const dataPath = member(need(link, "PointDataLink"), prefix);
    const data = files.get(dataPath);
    if (!data) throw new FormatError(`The data file "${dataPath}" is missing from the file`);
    if (data.length !== points * layers * stride) {
      throw new FormatError(`The data file holds ${data.length} bytes, but the dimensions and axes need ${points * layers * stride}`);
    }
    let valid: Uint8Array | null = null;
    const validLink = child(link, "ValidPointsLink");
    if (validLink) {
      const validPath = member(validLink, prefix);
      const bits = files.get(validPath);
      if (!bits) throw new FormatError(`The validity file "${validPath}" is missing from the file`);
      if (bits.length !== Math.ceil((points * layers) / 8)) throw new FormatError("The validity file does not fit the dimensions");
      valid = bits;
    }
    decode = (layer) => decodeBinary(data, valid, layer, points, stride, absolute);
  } else {
    const datums = Array.from((dataList as Element).children).filter((e) => e.localName === "Datum");
    if (datums.length !== points * layers) {
      throw new FormatError(`The DataList holds ${datums.length} Datum elements, but ${points * layers} are needed`);
    }
    decode = (layer) => decodeText(datums, layer, points, absolute);
  }

  const featureType = (text(child(record1, "FeatureType")) ?? "").toUpperCase();
  const layer = (index: number): Surface => {
    const arrays = decode(index);
    return toSurface(arrays, { cloud, columns, rows, x, y });
  };
  return {
    format: "x3p",
    name,
    layerCount: layers,
    layer,
    info: describe({
      root, record1, featureType: cloud ? "PCL" : featureType, columns, rows, layers, x, y, z, binary: !!link, axesElement,
    }),
  };
}

/** The files by name, without what the operating system adds, and the folder that holds main.xml. */
function organize(entries: Record<string, Uint8Array>): { files: Files; prefix: string } {
  const files: Files = new Map();
  for (const [raw, content] of Object.entries(entries)) {
    const path = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    const parts = path.split("/");
    const base = (parts[parts.length - 1] as string).toLowerCase();
    if (path.endsWith("/") || parts.includes("__MACOSX") || base.startsWith("._") || base === ".ds_store" || base === "thumbs.db" || base === "desktop.ini") {
      continue;
    }
    files.set(path, content);
  }
  if (files.has("main.xml")) return { files, prefix: "" };
  // A file packed by hand has all its content in a single folder.
  const nested = [...files.keys()].filter((path) => /^[^/]+\/main\.xml$/.test(path));
  if (nested.length === 1) return { files, prefix: (nested[0] as string).slice(0, -"main.xml".length) };
  return { files, prefix: "" };
}

function member(link: Element, prefix: string): string {
  const path = (text(link) ?? "").replace(/\\/g, "/");
  if (path === "" || path.startsWith("/") || path.split("/").includes("..") || /^[a-z]+:/i.test(path)) {
    throw new FormatError(`The link "${path}" leaves the file`);
  }
  return prefix + path.replace(/^\.\//, "");
}

function child(parent: Element, name: string): Element | undefined {
  for (const element of Array.from(parent.children)) if (element.localName === name) return element;
  return undefined;
}

function need(parent: Element, name: string): Element {
  const element = child(parent, name);
  if (!element) throw new FormatError(`The file does not contain the required element ${name}`);
  return element;
}

function text(element: Element | undefined): string | undefined {
  const value = element?.textContent?.trim();
  return value ? value : undefined;
}

function number(element: Element | undefined, what: string): number {
  const value = Number(text(element));
  if (Number.isNaN(value)) throw new FormatError(`The value of ${what} is not a number`);
  return value;
}

function count(element: Element): number {
  const value = number(element, element.localName);
  if (!Number.isInteger(value) || value < 1) throw new FormatError(`${element.localName} must be a positive whole number`);
  return value;
}

function parseAxis(element: Element, name: string): Axis {
  const kind = text(child(element, "AxisType"));
  if (kind !== "I" && kind !== "A") throw new FormatError(`${name}: unknown AxisType "${kind}"`);
  const absolute = kind === "A";
  const type = text(child(element, "DataType")) ?? (absolute ? "" : "D");
  if (!(type in TYPES)) throw new FormatError(`${name}: unknown or missing DataType "${type}"`);
  // Files may omit the increment; it is then 1.
  const incrementText = text(child(element, "Increment"));
  const increment = incrementText === undefined ? 1 : number(child(element, "Increment"), `${name}: Increment`);
  if (increment === 0) throw new FormatError(`${name}: Increment must not be zero`);
  return { absolute, type, increment };
}

function decodeBinary(
  data: Uint8Array, valid: Uint8Array | null, layer: number, points: number, stride: number,
  absolute: readonly (readonly [string, Axis])[],
): Map<string, Float32Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const first = layer * points;
  const arrays = new Map<string, Float32Array>();
  let offset = 0;
  for (const [name, axis] of absolute) {
    const type = TYPES[axis.type] as FieldType;
    const out = new Float32Array(points);
    for (let i = 0; i < points; i++) {
      const value = type.read(view, (first + i) * stride + offset) * axis.increment;
      out[i] = Number.isFinite(value) ? value : NaN;
    }
    arrays.set(name, out);
    offset += type.size;
  }
  if (valid) {
    for (let i = 0; i < points; i++) {
      const bit = first + i;
      if (!((valid[bit >> 3] as number) >> (bit & 7) & 1)) for (const out of arrays.values()) out[i] = NaN;
    }
  }
  return arrays;
}

function decodeText(
  datums: Element[], layer: number, points: number, absolute: readonly (readonly [string, Axis])[],
): Map<string, Float32Array> {
  const arrays = new Map<string, Float32Array>(absolute.map(([name]) => [name, new Float32Array(points).fill(NaN)]));
  const outputs = [...arrays.values()];
  for (let i = 0; i < points; i++) {
    const content = ((datums[layer * points + i] as Element).textContent ?? "").trim();
    if (content === "") continue;
    const values = content.split(";");
    if (values.length !== absolute.length) throw new FormatError("A Datum does not hold one value for each absolute axis");
    for (let a = 0; a < values.length; a++) {
      const value = Number(values[a]) * (absolute[a] as readonly [string, Axis])[1].increment;
      (outputs[a] as Float32Array)[i] = Number.isFinite(value) ? value : NaN;
    }
  }
  return arrays;
}

interface Layout {
  cloud: boolean;
  columns: number;
  rows: number;
  x: Axis;
  y: Axis;
}

function toSurface(arrays: Map<string, Float32Array>, layout: Layout): Surface {
  const z = arrays.get("z") as Float32Array;
  const regular = !layout.x.absolute && !layout.y.absolute;
  if (layout.cloud) {
    // A point cloud holds no points that are not measured; a file that has some is read without them.
    const x = arrays.get("x") as Float32Array;
    const y = arrays.get("y") as Float32Array;
    const keep: number[] = [];
    for (let i = 0; i < z.length; i++) {
      if (Number.isFinite(z[i]) && Number.isFinite(x[i]) && Number.isFinite(y[i])) keep.push(i);
    }
    const pick = (array: Float32Array): Float32Array => Float32Array.from(keep, (i) => array[i] as number);
    return { kind: "cloud", columns: keep.length, rows: 1, stepX: 0, stepY: 0, z: pick(z), x: pick(x), y: pick(y) };
  }
  if (regular) {
    return {
      kind: "grid", columns: layout.columns, rows: layout.rows,
      stepX: Math.abs(layout.x.increment), stepY: Math.abs(layout.y.increment), z, x: null, y: null,
    };
  }
  // One lateral axis may be regular while the other is absolute: the positions are then given for all points.
  const x = arrays.get("x") ?? new Float32Array(z.length);
  const y = arrays.get("y") ?? new Float32Array(z.length);
  if (!arrays.has("x")) for (let i = 0; i < z.length; i++) x[i] = (i % layout.columns) * layout.x.increment;
  if (!arrays.has("y")) for (let i = 0; i < z.length; i++) y[i] = Math.floor(i / layout.columns) * layout.y.increment;
  return { kind: "grid", columns: layout.columns, rows: layout.rows, stepX: 0, stepY: 0, z, x, y };
}

interface Description {
  root: Element;
  record1: Element;
  featureType: string;
  columns: number;
  rows: number;
  layers: number;
  x: Axis;
  y: Axis;
  z: Axis;
  binary: boolean;
  axesElement: Element;
}

const FEATURES: Record<string, string> = { SUR: "Surface", PRF: "Profile", PCL: "Point cloud" };

function describe(d: Description): InfoSection[] {
  const g = (value: number): string => String(Number(value.toPrecision(10)));
  const axis = (a: Axis): string => (a.absolute ? `absolute, ${TYPE_NAMES[a.type]}, factor ${g(a.increment)}` : `regular, step ${formatLength(Math.abs(a.increment))}`);
  const sections: InfoSection[] = [
    {
      title: "File",
      rows: [
        ["Format", "x3p, " + (d.binary ? "binary" : "text")],
        ["Revision", text(child(d.record1, "Revision")) ?? "not set"],
        ["Feature", FEATURES[d.featureType] ?? d.featureType],
        ["Layers", String(d.layers)],
      ],
    },
    {
      title: "Data",
      rows: [
        [d.featureType === "PCL" ? "Points" : "Points per row", String(d.columns)],
        ...(d.featureType === "PCL" ? [] : ([["Rows", String(d.rows)]] as [string, string][])),
        ["x axis", axis(d.x)],
        ["y axis", axis(d.y)],
        ["z axis", axis(d.z)],
      ],
    },
  ];
  const record2 = child(d.root, "Record2");
  if (record2) {
    const rows: [string, string][] = [];
    const walk = (element: Element, path: string): void => {
      const kids = Array.from(element.children);
      if (kids.length === 0) {
        const value = text(element);
        if (value !== undefined) rows.push([path, value]);
        return;
      }
      for (const kid of kids) walk(kid, path ? `${path} / ${kid.localName}` : kid.localName);
    };
    for (const kid of Array.from(record2.children)) walk(kid, kid.localName);
    if (rows.length) sections.push({ title: "Metadata", rows });
  }
  const rotation = child(d.axesElement, "Rotation");
  const offsets = ["CX", "CY", "CZ"].map((name) => Number(text(child(child(d.axesElement, name) as Element, "Offset")) ?? 0));
  const turned = rotation !== undefined && Array.from(rotation.children).some((e, i) => Math.abs(Number(e.textContent) - (i % 4 === 0 ? 1 : 0)) > 1e-9);
  if (turned || offsets.some((offset) => offset !== 0)) {
    sections[0]?.rows.push(["Placement", "stored in the file, not applied"]);
  }
  return sections;
}
