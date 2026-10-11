// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The build is a single HTML file: it opens from a file, and from any static host such as GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022' },
  test: { environment: 'happy-dom', include: ['test/**/*.test.ts'] },
});
