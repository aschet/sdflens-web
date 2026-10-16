// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import { readFile } from '../src/formats';
import { formatDate } from '../src/formats/info';

function info(name: string): Record<string, Record<string, string>> {
  const bytes = new Uint8Array(
    readFileSync(join(process.cwd(), 'test', 'samples', name)),
  );
  const sections: Record<string, Record<string, string>> = {};
  for (const section of readFile(bytes, name).info)
    sections[section.title] = Object.fromEntries(section.rows);
  return sections;
}

function comment(name: string): string | undefined {
  const bytes = new Uint8Array(
    readFileSync(join(process.cwd(), 'test', 'samples', name)),
  );
  return readFile(bytes, name).info.find((section) => section.title === 'Comment')
    ?.text;
}

describe('file information', () => {
  it('has the same sections for SDF and x3p, without the trailer and the metadata block', () => {
    for (const name of [
      'iso2_surface_binary.sdf',
      'x3pio_surface_binary.x3p',
      'bcr1_profile_ascii.sdf',
      'x3pio_point_cloud_binary.x3p',
    ]) {
      // The comment has a section of its own, which only a file with a comment has.
      const titles = Object.keys(info(name)).filter((title) => title !== 'Comment');
      expect(titles).toEqual(['File', 'Data', 'Instrument', 'Probing']);
    }
  });

  it('names the format with its encoding and the revision', () => {
    expect(info('iso2_surface_binary.sdf').File).toMatchObject({
      Format: 'SDF binary',
      Revision: 'ISO-2.0',
    });
    expect(info('iso2_surface_ascii.sdf').File).toMatchObject({ Format: 'SDF ASCII' });
    expect(info('iso1_surface_binary.sdf').File).toMatchObject({ Revision: 'ISO-1.0' });
    expect(info('bcr1_surface_binary.sdf').File).toMatchObject({ Revision: 'BCR-1.0' });
    // The revision is the identifier that the file states.
    expect(info('x3pio_surface_binary.x3p').File).toMatchObject({
      Format: 'x3p binary',
      Revision: 'ISO25178-72:2017/DAM1',
    });
    expect(info('x3pio_surface_xml.x3p').File).toMatchObject({ Format: 'x3p XML' });
  });

  it('names the feature, a single profile of an SDF file being a profile', () => {
    expect(info('iso1_profile_binary.sdf').File).toMatchObject({ Feature: 'Profile' });
    expect(info('iso1_surface_binary.sdf').File).toMatchObject({ Feature: 'Surface' });
    expect(info('x3pio_profile_binary.x3p').File).toMatchObject({ Feature: 'Profile' });
    expect(info('x3pio_point_cloud_binary.x3p').File).toMatchObject({
      Feature: 'Point cloud',
    });
  });

  it('combines the dimension and the step, and does not repeat the layers, which have their own switch', () => {
    const surface = info('iso2_surface_binary.sdf');
    expect(surface.Data).toMatchObject({
      Dimension: '48 × 32 points',
      Step: '2 µm × 3 µm',
    });
    expect(surface.File).not.toHaveProperty('Layers');
    expect(info('x3pio_surface_layers_binary.x3p').File).not.toHaveProperty('Layers');
    expect(info('iso1_profile_binary.sdf').Data).toMatchObject({
      Dimension: '128 points',
      Step: '2 µm',
    });
    expect(info('x3pio_surface_irregular_binary.x3p').Data).toMatchObject({
      Step: 'irregular',
    });
    expect(info('x3pio_point_cloud_binary.x3p').Data).toMatchObject({
      Step: 'irregular',
    });
  });

  it('names the data type of each axis in one row, the same way for SDF and x3p', () => {
    // An SDF file stores only the heights; its lateral axes are given by the steps.
    expect(info('iso2_surface_binary.sdf').Data).toMatchObject({ Type: 'int16' });
    expect(info('iso2_surface_binary32_ascii.sdf').Data).toMatchObject({
      Type: 'float32',
    });
    expect(info('x3pio_surface_binary.x3p').Data).toMatchObject({
      Type: 'float64, float64, int16',
    });
    expect(info('x3pio_point_cloud_binary.x3p').Data).toMatchObject({
      Type: 'float32, float32, float32',
    });
  });

  it('says which axis is incremental and which is absolute, in the order of the types, for SDF and x3p', () => {
    expect(info('iso2_surface_binary.sdf').Data).toMatchObject({
      Axis: 'inc, inc, abs',
    });
    expect(info('x3pio_surface_binary.x3p').Data).toMatchObject({
      Axis: 'inc, inc, abs',
    });
    expect(info('x3pio_surface_irregular_binary.x3p').Data).toMatchObject({
      Axis: 'abs, abs, abs',
    });
    expect(info('x3pio_point_cloud_binary.x3p').Data).toMatchObject({
      Axis: 'abs, abs, abs',
    });
  });

  it('shows the comment of a file that has one in a section of its own at the end', () => {
    const titles = Object.keys(info('x3pio_surface_binary.x3p'));
    expect(titles.at(-1)).toBe('Comment');
    expect(comment('x3pio_surface_binary.x3p')).toBe(
      'A surface of one layer with missing points, heights in int16.',
    );
    // A file without one has no section for it.
    expect(Object.keys(info('x3pio_profile_irregular_binary.x3p'))).not.toContain(
      'Comment',
    );
    expect(Object.keys(info('iso2_surface_binary.sdf'))).not.toContain('Comment');
  });

  it('lists the fields of the instrument and of the probing system for both formats, with a dash for what a file does not give', () => {
    const fields = ['Manufacturer', 'Model', 'Serial', 'Version', 'Calibration'];
    const sdf = info('iso2_surface_binary.sdf');
    expect(Object.keys(sdf.Instrument as object)).toEqual(fields);
    expect(sdf.Instrument).toMatchObject({
      Manufacturer: 'sdfio',
      Model: '-',
      Serial: '-',
      Calibration: '-',
    });
    expect(sdf.Probing).toEqual({ Type: '-', Identification: '-' });
    const x3p = info('x3pio_surface_binary.x3p');
    expect(Object.keys(x3p.Instrument as object)).toEqual(fields);
    expect(x3p.Instrument).toMatchObject({
      Manufacturer: 'x3pio',
      Model: 'tests/samples/generate.py',
      Serial: '-',
      Version: '1',
    });
    expect(x3p.Probing).toEqual({ Type: 'Software', Identification: 'synthetic data' });
    // The probing system follows the instrument.
    expect(Object.keys(x3p).slice(2, 4)).toEqual(['Instrument', 'Probing']);
  });

  it('shows the creator and the date in the file section for both formats', () => {
    const sdf = info('iso2_surface_binary.sdf');
    const x3p = info('x3pio_surface_binary.x3p');
    expect(Object.keys(sdf.File as object).slice(-2)).toEqual(['Creator', 'Date']);
    expect(Object.keys(x3p.File as object).slice(-2)).toEqual(['Creator', 'Date']);
    expect(x3p.File).toMatchObject({ Creator: 'x3pio sample generator' });
    // An SDF file does not name a creator, which shows as a dash.
    expect(sdf.File).toMatchObject({ Creator: '-' });
    expect(sdf.File?.Date).toBe(x3p.File?.Date);
    // The modification date is not shown.
    expect(JSON.stringify([sdf, x3p])).not.toMatch(/Modified|Source/);
  });

  it('writes dates in the locale and the time zone of the system, converting a date that has a zone', () => {
    const local = (date: Date): string =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    // The same instant in UTC and with an offset is shown the same way.
    expect(formatDate('2024-05-01T10:00:00Z')).toBe(
      local(new Date(Date.UTC(2024, 4, 1, 10, 0))),
    );
    expect(formatDate('2024-05-01T12:00:00.0+02:00')).toBe(
      local(new Date(Date.UTC(2024, 4, 1, 10, 0))),
    );
    // A date without a zone is local time already.
    expect(formatDate('2024-05-01 10:00:00')).toBe(local(new Date(2024, 4, 1, 10, 0)));
    expect(info('iso2_surface_binary.sdf').File).toMatchObject({
      Date: local(new Date(Date.UTC(2026, 0, 1, 12, 0))),
    });
  });

  it('converts to the time zone and the locale that are asked for', () => {
    expect(formatDate('2024-05-01T12:00:00+02:00', 'en-GB', 'UTC')).toBe(
      '1 May 2024, 10:00',
    );
    expect(formatDate('2024-05-01T10:00:00Z', 'en-US', 'America/New_York')).toBe(
      'May 1, 2024, 6:00 AM',
    );
    expect(formatDate('2024-05-01T10:00:00+0530', 'en-GB', 'UTC')).toBe(
      '1 May 2024, 04:30',
    );
  });

  it('leaves out placeholders and text that is not a date', () => {
    expect(formatDate('N/A')).toBeUndefined();
    expect(formatDate('not a date')).toBeUndefined();
    expect(formatDate(undefined)).toBeUndefined();
  });

  it('shows a dash where a file has no date', () => {
    expect(info('x3pio_surface_binary.x3p').Instrument).toMatchObject({
      Calibration: '-',
    });
  });

  it('never fails because of a date', () => {
    for (const text of [
      '9999-99-99T99:99',
      '2024-02-30 10:00',
      '2024-13-01 10:00',
      '0000-01-01 00:00',
      '2024-05-01T25:00:00Z',
      '+275760-09-13T00:00Z',
      '10:00',
    ]) {
      expect(() => formatDate(text)).not.toThrow();
    }
    expect(formatDate('2024-02-30 10:00')).toBeUndefined();
    expect(formatDate('2024-05-01T25:00:00Z')).toBeUndefined();
  });

  it('loads a file whose dates cannot be read, showing a dash for them', () => {
    const bytes = new Uint8Array(
      readFileSync(join(process.cwd(), 'test', 'samples', 'x3pio_surface_binary.x3p')),
    );
    const files = unzipSync(bytes);
    const xml = strFromU8(files['main.xml'] as Uint8Array)
      .replace(/<Date>[^<]*<\/Date>/, '<Date>yesterday</Date>')
      .replace(
        /<CalibrationDate>[^<]*<\/CalibrationDate>/,
        '<CalibrationDate>2024-99-99</CalibrationDate>',
      );
    files['main.xml'] = strToU8(xml);
    const file = readFile(zipSync(files), 'bad-dates.x3p');
    const sections = Object.fromEntries(
      file.info.map((section) => [section.title, Object.fromEntries(section.rows)]),
    );
    expect(sections.File).toMatchObject({ Date: '-' });
    expect(sections.Instrument).toMatchObject({
      Calibration: '-',
      Manufacturer: 'x3pio',
    });
    expect(file.layer(0).columns).toBeGreaterThan(0);
  });
});
