# sdflens web

[![CI](https://github.com/aschet/sdflens-web/actions/workflows/ci.yml/badge.svg)](https://github.com/aschet/sdflens-web/actions/workflows/ci.yml)

Browser viewer for ISO 25178-71 Surface Data Files (`.sdf`) and ISO 25178-72 x3p files (`.x3p`), the web
counterpart of [sdflens](https://github.com/aschet/sdflens). It runs entirely in the browser: a file is read on
your computer and is not uploaded. The build is a single HTML file, so it also works from a local file and from
any static host, without a server of its own.

Online: <https://aschet.github.io/sdflens-web/>

## Features

- SDF in the dialects ISO-1.0, ISO-2.0 and BCR-1.0, ASCII and binary.
- x3p of both revisions of ISO 25178-72: surfaces, profiles, surfaces with absolute axes (irregular grids), point
  clouds and layers, with binary or text data and the validity file.
- 3D view (WebGL 2) with the render modes surface, grid and points, a height scale and colormaps.
- 2D height map and profile view, which stay fast for large grids.
- Click, tap or hover reads the position and height of a point.
- Mouse, touch (drag, pinch) and keyboard; light and dark theme; the layout follows the screen size.
- File information, and the view as PNG.

Not supported: SDF with compression or checksums, as in [sdfio](https://github.com/aschet/sdfio), and the placement
of an x3p file (rotation and offset of the axes), which is shown but not applied. The page does not save or convert
files.

## Development

Node.js 20 or newer.

```sh
npm ci
npm run dev        # development server
npm test           # unit tests and the sample files
npm run typecheck
npm run build      # dist/index.html
```

The code is TypeScript without a framework. `src/formats` has the readers, `src/render` the views and the
camera, `src/ui` the color bar and `src/main.ts` the page. The only dependency of the page is
[fflate](https://github.com/101arrowz/fflate) for the zip archive of an x3p file.

The tests read the files of `test/samples` and compare them with what [sdfio](https://github.com/aschet/sdfio) and
[x3pio](https://github.com/aschet/x3pio) read from the same files. `tools/make_expected.py` writes
`test/expected.json` from these libraries.

## Publishing

`.github/workflows/pages.yml` builds the page and publishes it with GitHub Pages. In the settings of the repository,
set the source of Pages to GitHub Actions.

## License

GPL-3.0-or-later. The colormaps and the zip library are covered by [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
