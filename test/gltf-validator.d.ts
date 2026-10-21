// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

declare module 'gltf-validator' {
  export interface Message {
    code: string;
    message: string;
    pointer?: string;
    severity: number;
  }
  export interface Report {
    issues: {
      numErrors: number;
      numWarnings: number;
      numInfos: number;
      numHints: number;
      messages: Message[];
    };
  }
  export function validateBytes(
    data: Uint8Array,
    options?: { uri?: string },
  ): Promise<Report>;
}
