// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** Reader for ISO 25178-72 x3p files: surfaces, profiles and point clouds, in both revisions. */

import { unzipSync } from 'fflate';
import {
  FormatError,
  type InfoSection,
  type Surface,
  type SurfaceFile,
} from '../model';
import {
  describeFile,
  featureOf,
  formatDate,
  safely,
  sizeText,
  stepText,
} from './info';

interface Axis {
  absolute: boolean;
  type: string;
  /** Whether the file names the data type; an incremental axis may leave it out. */
  declared: boolean;
  increment: number;
}

interface FieldType {
  size: number;
  read(view: DataView, offset: number): number;
}

const TYPE_NAMES: Record<string, string> = {
  I: 'int16',
  L: 'int32',
  F: 'float32',
  D: 'float64',
};

const TYPES: Record<string, FieldType> = {
  I: { size: 2, read: (view, offset) => view.getInt16(offset, true) },
  L: { size: 4, read: (view, offset) => view.getInt32(offset, true) },
  F: { size: 4, read: (view, offset) => view.getFloat32(offset, true) },
  D: { size: 8, read: (view, offset) => view.getFloat64(offset, true) },
};

type Files = Map<string, Uint8Array>;

/** Reads an x3p file. Throws a FormatError if it is not one, or is damaged. */
export function readX3p(bytes: Uint8Array, name: string): SurfaceFile {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new FormatError('Not an x3p file: it is not a zip archive');
  }
  const { files, prefix } = organize(entries);
  const mainBytes = files.get(prefix + 'main.xml');
  if (!mainBytes) throw new FormatError('The file contains no main.xml');
  const doc = new DOMParser().parseFromString(
    new TextDecoder('utf-8').decode(mainBytes).replace(/^\uFEFF/, ''),
    'application/xml',
  );
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new FormatError('main.xml is not valid XML');
  }
  const root = doc.documentElement;

  const record1 = need(root, 'Record1');
  const record3 = need(root, 'Record3');
  const axesElement = need(record1, 'Axes');
  const [x, y, z] = ['CX', 'CY', 'CZ'].map((axis) =>
    parseAxis(need(axesElement, axis), axis),
  ) as [Axis, Axis, Axis];
  if (!z.absolute) throw new FormatError('The z axis must be an absolute axis');

  const matrix = child(record3, 'MatrixDimension');
  const list = child(record3, 'ListDimension');
  if (!matrix === !list)
    throw new FormatError(
      'Record3 needs exactly one of MatrixDimension and ListDimension',
    );
  let columns: number;
  let rows: number;
  let layers: number;
  if (matrix) {
    columns = count(need(matrix, 'SizeX'));
    rows = count(need(matrix, 'SizeY'));
    layers = count(need(matrix, 'SizeZ'));
  } else {
    columns = count(list as Element);
    rows = 1;
    layers = 1;
  }
  const cloud = !matrix;
  const declared = text(child(record1, 'FeatureType'));
  if (declared !== undefined && !FEATURE_TYPES.includes(declared))
    throw new FormatError(`Unknown FeatureType ${declared}`);
  // The declared type decides, as far as the data allows it: a profile has a single row. A file without it is
  // judged by its shape.
  const isProfile =
    !cloud &&
    (declared === undefined
      ? rows === 1 || columns === 1
      : declared === 'PRF' && rows === 1);
  const points = columns * rows;
  if (cloud && (!x.absolute || !y.absolute))
    throw new FormatError('The axes of a point cloud must be absolute');

  // The coordinates of the absolute axes follow each other in one record per point.
  const absolute = (
    [
      ['x', x],
      ['y', y],
      ['z', z],
    ] as const
  ).filter(([, axis]) => axis.absolute);
  const stride = absolute.reduce(
    (sum, [, axis]) => sum + (TYPES[axis.type] as FieldType).size,
    0,
  );

  const link = child(record3, 'DataLink');
  const dataList = child(record3, 'DataList');
  if (!link === !dataList)
    throw new FormatError('Record3 needs exactly one of DataLink and DataList');

  let decode: (layer: number) => Map<string, Float32Array>;
  if (link) {
    const dataPath = member(need(link, 'PointDataLink'), prefix);
    const data = files.get(dataPath);
    if (!data)
      throw new FormatError(`The data file "${dataPath}" is missing from the file`);
    if (data.length !== points * layers * stride) {
      throw new FormatError(
        `The data file holds ${data.length} bytes, but the dimensions and axes need ${points * layers * stride}`,
      );
    }
    let valid: Uint8Array | null = null;
    const validLink = child(link, 'ValidPointsLink');
    if (validLink) {
      const validPath = member(validLink, prefix);
      const bits = files.get(validPath);
      if (!bits)
        throw new FormatError(
          `The validity file "${validPath}" is missing from the file`,
        );
      if (bits.length !== Math.ceil((points * layers) / 8))
        throw new FormatError('The validity file does not fit the dimensions');
      valid = bits;
    }
    decode = (layer) => decodeBinary(data, valid, layer, points, stride, absolute);
  } else {
    const datums = Array.from((dataList as Element).children).filter(
      (e) => e.localName === 'Datum',
    );
    if (datums.length !== points * layers) {
      throw new FormatError(
        `The DataList holds ${datums.length} Datum elements, but ${points * layers} are needed`,
      );
    }
    decode = (layer) => decodeText(datums, layer, points, absolute);
  }

  const layer = (index: number): Surface => {
    const arrays = decode(index);
    return toSurface(arrays, { cloud, isProfile, columns, rows, x, y });
  };
  return {
    format: 'x3p',
    name,
    layerCount: layers,
    layer,
    info: safely(() =>
      describe({
        root,
        record1,
        axesElement,
        cloud,
        isProfile,
        columns,
        rows,
        x,
        y,
        z,
        binary: !!link,
        // The step of a profile with an absolute axis comes from its positions.
        profile:
          profileAxis({ cloud, isProfile, columns, rows, x, y }) &&
          (x.absolute || y.absolute)
            ? layer(0)
            : null,
      }),
    ),
  };
}

/** The files by name, without what the operating system adds, and the folder that holds main.xml. */
function organize(entries: Record<string, Uint8Array>): {
  files: Files;
  prefix: string;
} {
  const files: Files = new Map();
  for (const [raw, content] of Object.entries(entries)) {
    const path = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = path.split('/');
    const base = (parts[parts.length - 1] as string).toLowerCase();
    if (
      path.endsWith('/') ||
      parts.includes('__MACOSX') ||
      base.startsWith('._') ||
      base === '.ds_store' ||
      base === 'thumbs.db' ||
      base === 'desktop.ini'
    ) {
      continue;
    }
    files.set(path, content);
  }
  if (files.has('main.xml')) return { files, prefix: '' };
  // A file packed by hand has all its content in a single folder.
  const nested = [...files.keys()].filter((path) => /^[^/]+\/main\.xml$/.test(path));
  if (nested.length === 1)
    return { files, prefix: (nested[0] as string).slice(0, -'main.xml'.length) };
  return { files, prefix: '' };
}

function member(link: Element, prefix: string): string {
  const path = (text(link) ?? '').replace(/\\/g, '/');
  if (
    path === '' ||
    path.startsWith('/') ||
    path.split('/').includes('..') ||
    /^[a-z]+:/i.test(path)
  ) {
    throw new FormatError(`The link "${path}" leaves the file`);
  }
  return prefix + path.replace(/^\.\//, '');
}

function child(parent: Element, name: string): Element | undefined {
  for (const element of Array.from(parent.children))
    if (element.localName === name) return element;
  return undefined;
}

function need(parent: Element, name: string): Element {
  const element = child(parent, name);
  if (!element)
    throw new FormatError(`The file does not contain the required element ${name}`);
  return element;
}

function text(element: Element | undefined): string | undefined {
  const value = element?.textContent.trim();
  return value === '' ? undefined : value;
}

function number(element: Element | undefined, what: string): number {
  const value = Number(text(element));
  if (Number.isNaN(value))
    throw new FormatError(`The value of ${what} is not a number`);
  return value;
}

function count(element: Element): number {
  const value = number(element, element.localName);
  if (!Number.isInteger(value) || value < 1)
    throw new FormatError(`${element.localName} must be a positive whole number`);
  return value;
}

function parseAxis(element: Element, name: string): Axis {
  const kind = text(child(element, 'AxisType'));
  if (kind !== 'I' && kind !== 'A')
    throw new FormatError(`${name}: unknown AxisType "${kind}"`);
  const absolute = kind === 'A';
  const declared = text(child(element, 'DataType'));
  const type = declared ?? (absolute ? '' : 'D');
  if (!(type in TYPES))
    throw new FormatError(`${name}: unknown or missing DataType "${type}"`);
  // Files may omit the increment; it is then 1.
  const incrementText = text(child(element, 'Increment'));
  const increment =
    incrementText === undefined
      ? 1
      : number(child(element, 'Increment'), `${name}: Increment`);
  if (increment === 0) throw new FormatError(`${name}: Increment must not be zero`);
  return { absolute, type, declared: declared !== undefined, increment };
}

function decodeBinary(
  data: Uint8Array,
  valid: Uint8Array | null,
  layer: number,
  points: number,
  stride: number,
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
      if (!(((valid[bit >> 3] as number) >> (bit & 7)) & 1))
        for (const out of arrays.values()) out[i] = NaN;
    }
  }
  return arrays;
}

function decodeText(
  datums: Element[],
  layer: number,
  points: number,
  absolute: readonly (readonly [string, Axis])[],
): Map<string, Float32Array> {
  const arrays = new Map<string, Float32Array>(
    absolute.map(([name]) => [name, new Float32Array(points).fill(NaN)]),
  );
  const outputs = [...arrays.values()];
  for (let i = 0; i < points; i++) {
    const content = (datums[layer * points + i] as Element).textContent.trim();
    if (content === '') continue;
    const values = content.split(';');
    if (values.length !== absolute.length)
      throw new FormatError('A Datum does not hold one value for each absolute axis');
    for (let a = 0; a < values.length; a++) {
      const value =
        Number(values[a]) * (absolute[a] as readonly [string, Axis])[1].increment;
      (outputs[a] as Float32Array)[i] = Number.isFinite(value) ? value : NaN;
    }
  }
  return arrays;
}

/** The axis along which a profile of a single row or column runs. */
function profileAxis(layout: Layout): 'x' | 'y' | null {
  if (layout.cloud || !layout.isProfile) return null;
  if (layout.rows === 1 && layout.columns > 1) return 'x';
  if (layout.columns === 1 && layout.rows > 1) return 'y';
  return null;
}

/** Whether a number can be a position in meters: a damaged file may hold any number. */
function plausible(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) < 1e3;
}

type ProfileStep =
  { step: number; assumed: boolean } | { irregular: true; descending: boolean } | null;

/**
 * The step of a profile. Positions along an absolute axis that are evenly spaced give their spacing; positions that
 * are increasing or decreasing but not evenly spaced make an irregular profile. Positions that are not usable, that
 * is not finite or neither increasing nor decreasing, are replaced by the step of the other lateral axis if that one
 * is regular, and the step is then marked as assumed.
 */
function profileStep(
  positions: Float32Array | undefined,
  axis: Axis,
  other: Axis,
): ProfileStep {
  if (!axis.absolute) return { step: Math.abs(axis.increment), assumed: false };
  if (positions) {
    const count = positions.length;
    const first = positions[0] as number;
    const mean = ((positions[count - 1] as number) - first) / (count - 1);
    let monotonic = Number.isFinite(mean) && mean !== 0;
    let even = true;
    for (let i = 1; monotonic && i < count; i++) {
      const gap = (positions[i] as number) - (positions[i - 1] as number);
      if (
        !plausible(positions[i] as number) ||
        !Number.isFinite(gap) ||
        gap * mean <= 0
      ) {
        monotonic = false;
      } else if (Math.abs(gap - mean) > 0.02 * Math.abs(mean)) even = false;
    }
    if (monotonic)
      return even
        ? { step: Math.abs(mean), assumed: false }
        : { irregular: true, descending: mean < 0 };
  }
  return other.absolute ? null : { step: Math.abs(other.increment), assumed: true };
}

const FEATURE_TYPES = ['PRF', 'SUR', 'PCL'];

interface Layout {
  cloud: boolean;
  /** Whether the data is a profile, which the type of the file decides. */
  isProfile: boolean;
  columns: number;
  rows: number;
  x: Axis;
  y: Axis;
}

function toSurface(arrays: Map<string, Float32Array>, layout: Layout): Surface {
  const z = arrays.get('z') as Float32Array;
  const regular = !layout.x.absolute && !layout.y.absolute;
  if (layout.cloud) {
    // A point cloud holds no points that are not measured; a file that has some is read without them.
    const x = arrays.get('x') as Float32Array;
    const y = arrays.get('y') as Float32Array;
    const keep: number[] = [];
    for (let i = 0; i < z.length; i++) {
      if (Number.isFinite(z[i]) && Number.isFinite(x[i]) && Number.isFinite(y[i]))
        keep.push(i);
    }
    const pick = (array: Float32Array): Float32Array =>
      Float32Array.from(keep, (i) => array[i] as number);
    return {
      kind: 'cloud',
      columns: keep.length,
      rows: 1,
      stepX: 0,
      stepY: 0,
      z: pick(z),
      x: pick(x),
      y: pick(y),
    };
  }
  if (regular) {
    return {
      kind: 'grid',
      columns: layout.columns,
      rows: layout.rows,
      stepX: Math.abs(layout.x.increment),
      stepY: Math.abs(layout.y.increment),
      z,
      x: null,
      y: null,
    };
  }
  const along = profileAxis(layout);
  if (along) {
    const given = arrays.get(along);
    const found = profileStep(
      given,
      along === 'x' ? layout.x : layout.y,
      along === 'x' ? layout.y : layout.x,
    );
    // The positions across the profile count if they are given and vary, as for a profile along a diagonal.
    const across = arrays.get(along === 'x' ? 'y' : 'x');
    const diagonal =
      across !== undefined &&
      across.every(plausible) &&
      across.some((value) => value !== across[0]);
    if (found && 'step' in found && !diagonal) {
      // Only the axis along the profile matters; the other has a single position.
      return {
        kind: 'grid',
        columns: layout.columns,
        rows: layout.rows,
        stepX: found.step,
        stepY: found.step,
        z,
        x: null,
        y: null,
        ...(found.assumed ? { stepAssumed: true } : {}),
      };
    }
    if (found && given && !('step' in found)) {
      // An irregular profile: the positions along the profile in increasing order, and zero across it.
      const order = found.descending
        ? (i: number): number => given.length - 1 - i
        : (i: number): number => i;
      const positions = Float32Array.from(given, (_, i) => given[order(i)] as number);
      const heights = Float32Array.from(z, (_, i) => z[order(i)] as number);
      const across = new Float32Array(z.length);
      return {
        kind: 'grid',
        columns: layout.columns,
        rows: layout.rows,
        stepX: 0,
        stepY: 0,
        z: heights,
        x: along === 'x' ? positions : across,
        y: along === 'y' ? positions : across,
        profile: true,
      };
    }
  }
  // One lateral axis may be regular while the other is absolute: the positions are then given for all points.
  const x = arrays.get('x') ?? new Float32Array(z.length);
  const y = arrays.get('y') ?? new Float32Array(z.length);
  if (!arrays.has('x'))
    for (let i = 0; i < z.length; i++) x[i] = (i % layout.columns) * layout.x.increment;
  if (!arrays.has('y'))
    for (let i = 0; i < z.length; i++)
      y[i] = Math.floor(i / layout.columns) * layout.y.increment;
  return {
    kind: 'grid',
    columns: layout.columns,
    rows: layout.rows,
    stepX: 0,
    stepY: 0,
    z,
    x,
    y,
    ...(along ? { profile: true } : {}),
  };
}

interface Context {
  root: Element;
  record1: Element;
  axesElement: Element;
  cloud: boolean;
  isProfile: boolean;
  columns: number;
  rows: number;
  x: Axis;
  y: Axis;
  z: Axis;
  binary: boolean;
  /** The first layer of a profile that has an absolute lateral axis. */
  profile: Surface | null;
}

function typeName(axis: Axis): string | undefined {
  return axis.declared ? TYPE_NAMES[axis.type] : undefined;
}

function describe(c: Context): InfoSection[] {
  const feature = featureOf(c.cloud, c.columns, c.rows, c.isProfile);
  const regular = c.profile ? c.profile.x === null : !c.x.absolute && !c.y.absolute;
  const record2 = child(c.root, 'Record2');
  const value = (...path: string[]): string | undefined => {
    let element: Element | undefined = record2;
    for (const name of path) element = element ? child(element, name) : undefined;
    return text(element);
  };

  const rotation = child(c.axesElement, 'Rotation');
  const offsets = ['CX', 'CY', 'CZ'].map((name) =>
    Number(text(child(child(c.axesElement, name) as Element, 'Offset')) ?? 0),
  );
  const turned =
    rotation !== undefined &&
    Array.from(rotation.children).some(
      (e, i) => Math.abs(Number(e.textContent) - (i % 4 === 0 ? 1 : 0)) > 1e-9,
    );

  return describeFile({
    format: `x3p ${c.binary ? 'binary' : 'XML'}`,
    revision: text(child(c.record1, 'Revision')) ?? 'not set',
    feature,
    size: sizeText(feature, c.columns, c.rows),
    step: regular
      ? c.profile
        ? stepText(
            feature,
            c.profile.stepX,
            c.profile.stepY,
            c.columns,
            c.profile.stepAssumed,
          )
        : stepText(feature, Math.abs(c.x.increment), Math.abs(c.y.increment), c.columns)
      : 'irregular',
    types: { x: typeName(c.x), y: typeName(c.y), z: TYPE_NAMES[c.z.type] as string },
    placement:
      turned || offsets.some((offset) => offset !== 0)
        ? 'stored in the file, not applied'
        : undefined,
    instrument: {
      Manufacturer: value('Instrument', 'Manufacturer'),
      Model: value('Instrument', 'Model'),
      Serial: value('Instrument', 'Serial'),
      Version: value('Instrument', 'Version'),
      Calibration: formatDate(value('CalibrationDate')),
    },
    probing: {
      Type: value('ProbingSystem', 'Type'),
      Identification: value('ProbingSystem', 'Identification'),
    },
    creator: value('Creator'),
    creation: formatDate(value('Date')),
  });
}
