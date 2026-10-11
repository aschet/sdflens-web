# sdflens web

[![CI](https://github.com/aschet/sdflens-web/actions/workflows/ci.yml/badge.svg)](https://github.com/aschet/sdflens-web/actions/workflows/ci.yml)

Browser viewer for topography and profile data in ISO 25178-71 Surface Data Files (`.sdf`) and ISO 25178-72 x3p
files (`.x3p`), the web counterpart of [sdflens](https://github.com/aschet/sdflens). The build is a single HTML
file, so it also works from a local file and from any static host, without a server of its own.

Online: <https://aschet.github.io/sdflens-web/>

Not supported: SDF with compression or checksums, as in [sdfio](https://github.com/aschet/sdfio), and the placement
of an x3p file (rotation and offset of the axes), which is shown but not applied. The page does not save or convert
files.

## Development

Node.js 22.12 or newer.

```sh
npm ci
npm run dev        # development server
npm test           # unit tests and the sample files
npm run lint       # ESLint
npm run format     # Prettier
npm run typecheck
npm run build      # dist/index.html
npm run check      # lint, format, type check, build and tests with coverage
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
