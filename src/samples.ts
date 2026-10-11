// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import microlens from "./samples/microlens-array.sdf?url";

export interface Sample {
  title: string;
  kind: string;
  file: string;
  url: string;
}

/** Files that are part of this page, for trying it without a file of one's own. */
export const SAMPLES: Sample[] = [
  { title: "Microlens array", kind: "SDF", file: "microlens-array.sdf", url: microlens },
];
