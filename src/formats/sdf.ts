// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** Reader for ISO 25178-71 SDF files: the dialects ISO-1.0, ISO-2.0 and BCR-1.0, ASCII and binary. */

import {
  FormatError,
  type InfoSection,
  type Surface,
  type SurfaceFile,
} from '../model';
import { formatLength } from '../units';
import {
  describeFile,
  featureOf,
  formatDate,
  safely,
  sizeText,
  stepText,
} from './info';

type Dialect = 'ISO-1.0' | 'ISO-2.0' | 'BCR-1.0';

interface DataType {
  name: string;
  size: number;
  integer: boolean;
  /** The smallest and the largest value, which mark a point that is not measured in ISO and in BCR. */
  min: number;
  max: number;
  dialects: Dialect[];
}

const ALL: Dialect[] = ['ISO-1.0', 'ISO-2.0', 'BCR-1.0'];
const DATA_TYPES: Record<number, DataType> = {
  0: { name: 'uint8', size: 1, integer: true, min: 0, max: 255, dialects: ['BCR-1.0'] },
  1: {
    name: 'uint16',
    size: 2,
    integer: true,
    min: 0,
    max: 65535,
    dialects: ['BCR-1.0'],
  },
  2: {
    name: 'uint32',
    size: 4,
    integer: true,
    min: 0,
    max: 4294967295,
    dialects: ['BCR-1.0'],
  },
  3: {
    name: 'float32',
    size: 4,
    integer: false,
    min: -3.4028234663852886e38,
    max: 3.4028234663852886e38,
    dialects: ['ISO-2.0', 'BCR-1.0'],
  },
  4: {
    name: 'int8',
    size: 1,
    integer: true,
    min: -128,
    max: 127,
    dialects: ['ISO-2.0', 'BCR-1.0'],
  },
  5: { name: 'int16', size: 2, integer: true, min: -32768, max: 32767, dialects: ALL },
  6: {
    name: 'int32',
    size: 4,
    integer: true,
    min: -2147483648,
    max: 2147483647,
    dialects: ALL,
  },
  7: {
    name: 'float64',
    size: 8,
    integer: false,
    min: -Number.MAX_VALUE,
    max: Number.MAX_VALUE,
    dialects: ALL,
  },
};

// BCR-1.0 lets an ASCII header name these values instead of giving the code.
const BCR_DATA_TYPES: Record<string, number> = {
  UCHAR: 0,
  UINTEGER: 1,
  ULONGINT: 2,
  FLOAT: 3,
  CHAR: 4,
  INTEGER: 5,
  LONGINT: 6,
  DOUBLE: 7,
};
const BCR_COMPRESSION: Record<string, number> = { NULL: 0, NONE: 0, RLL: 1 };
const BCR_CHECK: Record<string, number> = { NULL: 0, NONE: 0, UINTTRACE: 1 };

// BCR-1.0 marks a floating point value at or above these as not measured.
const BCR_FLOAT_BAD: Record<number, number> = { 4: 3.4e38, 8: 1.7e308 };

interface Header {
  dialect: Dialect;
  binary: boolean;
  manufacturer: string;
  created: string;
  columns: number;
  rows: number;
  xScale: number;
  yScale: number;
  zScale: number;
  zResolution: number;
  type: DataType;
}

/** Reads an SDF file. Throws a FormatError if it is not one, or uses what is not supported. */
export function readSdf(bytes: Uint8Array, name: string): SurfaceFile {
  const first = String.fromCharCode(bytes[0] ?? 0).toLowerCase();
  let header: Header;
  let z: Float32Array;
  if (first === 'b') {
    ({ header, z } = readBinary(bytes));
  } else if (first === 'a') {
    ({ header, z } = readAscii(bytes));
  } else {
    throw new FormatError('Not an SDF file');
  }
  const surface: Surface = {
    kind: 'grid',
    columns: header.columns,
    rows: header.rows,
    stepX: header.xScale,
    stepY: header.yScale,
    z,
    x: null,
    y: null,
  };
  return {
    format: 'sdf',
    name,
    layerCount: 1,
    layer: () => surface,
    info: safely(() => describe(header)),
  };
}

function resolveDialect(text: string, magic: string): Dialect {
  if (text === 'ISO-1.0' || text === 'ISO-2.0' || text === 'BCR-1.0') return text;
  throw new FormatError(`Unknown or unsupported SDF dialect in magic "${magic}"`);
}

function requireType(code: number, dialect: Dialect): DataType {
  const type = DATA_TYPES[code];
  if (type === undefined) throw new FormatError(`Unknown SDF data type code ${code}`);
  if (!type.dialects.includes(dialect)) {
    throw new FormatError(
      `The data type ${type.name} is not valid for the dialect ${dialect}`,
    );
  }
  return type;
}

function requireUnprocessed(compression: number, check: number): void {
  if (compression !== 0)
    throw new FormatError('Compressed SDF files are not supported');
  if (check !== 0) throw new FormatError('SDF files with checksums are not supported');
}

/** Whether a stored value marks a point that is not measured. */
function invalidTest(type: DataType, dialect: Dialect): (value: number) => boolean {
  if (dialect === 'BCR-1.0') {
    if (!type.integer) {
      const limit = BCR_FLOAT_BAD[type.size] as number;
      return (value) => value >= limit;
    }
    return (value) => value === type.max;
  }
  return (value) => value === type.min;
}

const DATE_ZERO = /^0+$/;

/** The date of the 12 digits DDMMYYYYhhmm as ISO 8601, with a Z for UTC; empty if the field holds no date. */
function isoDate(text: string, utc: boolean): string {
  const value = text.trim();
  const m = /^(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (DATE_ZERO.test(value) || !m) return '';
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00${utc ? 'Z' : ''}`;
}

function readBinary(bytes: Uint8Array): { header: Header; z: Float32Array } {
  if (bytes.length < 8)
    throw new FormatError('The file is too short to contain an SDF header');
  const magic = latin1(bytes.subarray(0, 8));
  if (!/^[abAB][A-Z]{3}-\d\.\d$/.test(magic))
    throw new FormatError(`Not an SDF file, unexpected magic: "${magic}"`);
  const dialect = resolveDialect(magic.slice(1), magic);
  const wide = dialect === 'ISO-2.0';
  const headerSize = wide ? 85 : 81;
  if (bytes.length < headerSize)
    throw new FormatError('The file is too short to contain an SDF header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (from: number, length: number): string =>
    latin1(bytes.subarray(from, from + length));
  // The manufacturer ends at the first NUL, which BCR allows and some ISO writers do as well.
  const manufacturer = text(8, 10).split('\u0000', 1)[0]!.trimEnd();
  const created = text(18, 12);
  let at = 42;
  let columns: number;
  let rows: number;
  if (wide) {
    columns = view.getUint32(at, true);
    rows = view.getUint32(at + 4, true);
    at += 8;
  } else {
    columns = view.getUint16(at, true);
    rows = view.getUint16(at + 2, true);
    at += 4;
  }
  const xScale = view.getFloat64(at, true);
  const yScale = view.getFloat64(at + 8, true);
  const zScale = view.getFloat64(at + 16, true);
  const zResolution = view.getFloat64(at + 24, true);
  const compression = view.getUint8(at + 32);
  const code = view.getUint8(at + 33);
  const check = view.getUint8(at + 34);
  requireUnprocessed(compression, check);
  const type = requireType(code, dialect);

  const count = columns * rows;
  const byteCount = count * type.size;
  if (bytes.length < headerSize + byteCount)
    throw new FormatError('Unexpected end of the file in the SDF data area');
  const raw = bytes.buffer.slice(
    bytes.byteOffset + headerSize,
    bytes.byteOffset + headerSize + byteCount,
  ) as ArrayBuffer;
  const z = decodeRaw(raw, type, zScale, dialect, count);
  if (dialect === 'BCR-1.0') reverseRows(z, rows, columns);
  const header: Header = {
    dialect,
    binary: true,
    manufacturer,
    created: isoDate(created, dialect === 'ISO-2.0'),
    columns,
    rows,
    xScale,
    yScale,
    zScale,
    zResolution,
    type,
  };
  return { header, z };
}

function decodeRaw(
  raw: ArrayBuffer,
  type: DataType,
  zScale: number,
  dialect: Dialect,
  count: number,
): Float32Array {
  const stored = storedArray(raw, type);
  const invalid = invalidTest(type, dialect);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const value = stored[i] as number;
    out[i] = invalid(value) ? NaN : value * zScale;
  }
  return out;
}

function storedArray(raw: ArrayBuffer, type: DataType): ArrayLike<number> {
  switch (type.name) {
    case 'uint8':
      return new Uint8Array(raw);
    case 'uint16':
      return new Uint16Array(raw);
    case 'uint32':
      return new Uint32Array(raw);
    case 'int8':
      return new Int8Array(raw);
    case 'int16':
      return new Int16Array(raw);
    case 'int32':
      return new Int32Array(raw);
    case 'float32':
      return new Float32Array(raw);
    default:
      return new Float64Array(raw);
  }
}

/** BCR stores the first profile at the maximum y; in the result row 0 has y = 0. */
function reverseRows(z: Float32Array, rows: number, columns: number): void {
  const row = new Float32Array(columns);
  for (let a = 0, b = rows - 1; a < b; a++, b--) {
    row.set(z.subarray(a * columns, (a + 1) * columns));
    z.copyWithin(a * columns, b * columns, (b + 1) * columns);
    z.set(row, b * columns);
  }
}

const LINE_BREAK = /\r\n|\n|\r/;
const TERMINATOR = /^[ \t]*\*[ \t]*$/;

function readAscii(bytes: Uint8Array): { header: Header; z: Float32Array } {
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
  const firstBreak = LINE_BREAK.exec(text);
  if (!firstBreak)
    throw new FormatError('The SDF file is missing the header and data records');
  const magicLine = text.slice(0, firstBreak.index).trim();
  const magic = /^([abAB])([A-Z]{3})-(\d\.\d)$/.exec(stripComment(magicLine).trim());
  if (!magic)
    throw new FormatError(`Not an ASCII SDF file, unexpected magic: "${magicLine}"`);
  const dialect = resolveDialect(`${magic[2]}-${magic[3]}`, magicLine);
  const bcr = dialect === 'BCR-1.0';
  const records = splitRecords(
    text.slice(firstBreak.index + firstBreak[0].length),
    bcr,
  );
  if (records.length < 3)
    throw new FormatError('The SDF file must contain header, data and trailer records');
  const [headerText, dataText] = records as [string, string, ...string[]];

  const fields = parseFields(headerText);
  const field = (key: string): string => {
    const value = fields.get(key.toLowerCase());
    if (value === undefined)
      throw new FormatError(`Missing required SDF header field "${key}"`);
    return value;
  };
  const coded = (key: string, names: Record<string, number>): number => {
    const value = field(key);
    const number = Number(value);
    if (value !== '' && Number.isInteger(number)) return number;
    const symbol = names[value.toUpperCase()];
    if (bcr && symbol !== undefined) return symbol;
    throw new FormatError(
      `Invalid integer value for the SDF header field "${key}": "${value}"`,
    );
  };
  const integer = (key: string): number => {
    const number = Number(field(key));
    if (!Number.isInteger(number))
      throw new FormatError(`Invalid integer value for the SDF header field "${key}"`);
    return number;
  };
  const float = (key: string): number => {
    const number = Number(field(key));
    if (Number.isNaN(number))
      throw new FormatError(`Invalid number for the SDF header field "${key}"`);
    return number;
  };

  const code = coded('DataType', BCR_DATA_TYPES);
  const type = requireType(code, dialect);
  requireUnprocessed(
    coded('Compression', BCR_COMPRESSION),
    coded('CheckType', BCR_CHECK),
  );
  const columns = integer('NumPoints');
  const rows = integer('NumProfiles');
  const zScale = float('Zscale');
  const header: Header = {
    dialect,
    binary: false,
    manufacturer: field('ManufacID').trim(),
    created: isoDate(field('CreateDate'), dialect === 'ISO-2.0'),
    columns,
    rows,
    xScale: float('Xscale'),
    yScale: float('Yscale'),
    zScale,
    zResolution: float('Zresolution'),
    type,
  };
  const z = parseAsciiData(dataText, header, type, dialect);
  if (bcr) reverseRows(z, rows, columns);
  return { header, z };
}

function stripComment(line: string): string {
  const at = line.indexOf(';');
  return at < 0 ? line : line.slice(0, at);
}

/** Splits at the lines that hold only "*". BCR may have comments, which end at the first two records. */
function splitRecords(text: string, comments: boolean): string[] {
  const records: string[] = [];
  let current: string[] = [];
  for (const line of text.split(LINE_BREAK)) {
    const bare = comments ? stripComment(line) : line;
    if (TERMINATOR.test(bare)) {
      records.push(current.join('\n'));
      current = [];
    } else {
      current.push(comments && records.length < 2 ? bare : line);
    }
  }
  records.push(current.join('\n'));
  return records;
}

function parseFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split(LINE_BREAK)) {
    const m = /^\s*(\w+)\s*=\s*(.*)$/.exec(line);
    if (m) fields.set((m[1] as string).toLowerCase(), (m[2] as string).trim());
  }
  return fields;
}

function parseAsciiData(
  text: string,
  header: Header,
  type: DataType,
  dialect: Dialect,
): Float32Array {
  const expected = header.columns * header.rows;
  const out = new Float32Array(expected);
  const invalid = invalidTest(type, dialect);
  // ISO writes BAD for a point that is not measured, BCR the largest value of the type.
  const markedByValue = dialect === 'BCR-1.0';
  const scale = header.zScale;
  let count = 0;
  let start = -1;
  const take = (end: number): void => {
    const token = text.slice(start, end);
    if (count < expected) {
      let value: number;
      const initial = token.charCodeAt(0);
      if (initial === 66 || initial === 98) {
        if (token.toUpperCase() !== 'BAD')
          throw new FormatError(`Invalid data value at position ${count}: "${token}"`);
        value = NaN;
      } else {
        const number = Number(token);
        if (Number.isNaN(number) || (type.integer && !Number.isInteger(number))) {
          throw new FormatError(`Invalid data value at position ${count}: "${token}"`);
        }
        value = markedByValue && invalid(number) ? NaN : number * scale;
      }
      out[count] = value;
    }
    count++;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const space = c === 32 || c === 9 || c === 10 || c === 13;
    if (space) {
      if (start >= 0) {
        take(i);
        start = -1;
      }
    } else if (start < 0) {
      start = i;
    }
  }
  if (start >= 0) take(text.length);
  if (count !== expected)
    throw new FormatError(`Expected ${expected} data values, found ${count}`);
  return out;
}

function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    text += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  return text;
}

function describe(header: Header): InfoSection[] {
  const feature = featureOf(false, header.columns, header.rows);
  return describeFile({
    format: `SDF ${header.binary ? 'binary' : 'ASCII'}`,
    revision: header.dialect,
    feature,
    size: sizeText(feature, header.columns, header.rows),
    step: stepText(feature, header.xScale, header.yScale, header.columns),
    // The lateral axes are given by their steps; only the heights are stored.
    types: { z: header.type.name },
    resolution: header.zResolution < 0 ? undefined : formatLength(header.zResolution),
    // An SDF file names only the manufacturer.
    creation: formatDate(header.created),
    instrument: { Manufacturer: header.manufacturer },
    probing: {},
  });
}
