// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import microlens from "./samples/microlens-array.sdf?url";
import layered from "./samples/layered-surface.x3p?url";
import cloud from "./samples/point-cloud.x3p?url";

export interface Sample {
  title: string;
  kind: string;
  file: string;
  url: string;
}

/** Files that are part of this page, for trying it without a file of one's own. */
export const SAMPLES: Sample[] = [
  { title: "Microlens array", kind: "SDF", file: "microlens-array.sdf", url: microlens },
  { title: "Layered surface", kind: "x3p", file: "layered-surface.x3p", url: layered },
  { title: "Point cloud", kind: "x3p", file: "point-cloud.x3p", url: cloud },
];
