// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import structures from "./samples/test-structures.sdf?url";

export interface Sample {
  title: string;
  kind: string;
  file: string;
  url: string;
}

/** Files that are part of this page, for trying it without a file of one's own. */
export const SAMPLES: Sample[] = [
  { title: "Test structures", kind: "SDF", file: "test-structures.sdf", url: structures },
];
