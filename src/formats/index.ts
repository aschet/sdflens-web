// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { FormatError, type SurfaceFile } from "../model";
import { readSdf } from "./sdf";
import { readX3p } from "./x3p";

export { readSdf, readX3p };

/** Reads an SDF or x3p file, told apart by its first bytes. */
export function readFile(bytes: Uint8Array, name: string): SurfaceFile {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readX3p(bytes, name);
  const first = String.fromCharCode(bytes[0] ?? 0).toLowerCase();
  if (first === "a" || first === "b") return readSdf(bytes, name);
  throw new FormatError("The file is neither an SDF nor an x3p file");
}
