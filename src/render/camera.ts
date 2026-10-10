// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** Orbit camera of the 3D view (right-handed, z up), the same as in sdflens. Matrices are row-major. */

export type Vec3 = [number, number, number];
export type Mat4 = number[];

const FOV_DEGREES = 40;
const HOME_AZIMUTH = -65;
const HOME_ELEVATION = 30;
const MAX_ELEVATION = 89;
const ROTATE_DEGREES_PER_PIXEL = 0.4;
const MIN_DISTANCE_FACTOR = 0.05;
const MAX_DISTANCE_FACTOR = 50;
const DEG = Math.PI / 180;

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};

export class Camera {
  radius = 1;
  azimuth = HOME_AZIMUTH;
  elevation = HOME_ELEVATION;
  distance = 1;
  target: Vec3 = [0, 0, 0];

  constructor() {
    this.fit(1);
  }

  /** Resets to the home view showing a bounding sphere of ``radius``; a narrow view needs more distance. */
  fit(radius: number, aspect = 1): void {
    this.radius = Math.max(radius, 1e-9);
    this.azimuth = HOME_AZIMUTH;
    this.elevation = HOME_ELEVATION;
    this.target = [0, 0, 0];
    const half = Math.atan(Math.min(aspect, 1) * Math.tan((FOV_DEGREES * DEG) / 2));
    this.distance = (this.radius / Math.sin(half)) * 1.1;
  }

  /** Changes the scene radius and keeps the apparent size of the scene. */
  setRadius(radius: number): void {
    radius = Math.max(radius, 1e-9);
    this.distance *= radius / this.radius;
    this.radius = radius;
  }

  rotate(dx: number, dy: number): void {
    this.azimuth -= dx * ROTATE_DEGREES_PER_PIXEL;
    this.elevation = Math.min(Math.max(this.elevation + dy * ROTATE_DEGREES_PER_PIXEL, -MAX_ELEVATION), MAX_ELEVATION);
  }

  setView(azimuth: number, elevation: number): void {
    this.azimuth = azimuth;
    this.elevation = Math.min(Math.max(elevation, -MAX_ELEVATION), MAX_ELEVATION);
  }

  /** Moves the target in the view plane by a mouse movement in pixels. */
  pan(dx: number, dy: number, viewportHeight: number): void {
    const [right, up] = this.axes();
    const perPixel = (2 * this.distance * Math.tan((FOV_DEGREES * DEG) / 2)) / Math.max(viewportHeight, 1);
    for (let i = 0; i < 3; i++) {
      this.target[i] = (this.target[i] as number) - (right[i] as number) * dx * perPixel + (up[i] as number) * dy * perPixel;
    }
  }

  /** Moves towards the target for a factor above 1 and away from it below. */
  zoom(factor: number): void {
    if (factor <= 0) return;
    this.distance = Math.min(Math.max(this.distance / factor, this.radius * MIN_DISTANCE_FACTOR), this.radius * MAX_DISTANCE_FACTOR);
  }

  eye(): Vec3 {
    const az = this.azimuth * DEG;
    const el = this.elevation * DEG;
    const direction: Vec3 = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    return [
      this.target[0] + direction[0] * this.distance,
      this.target[1] + direction[1] * this.distance,
      this.target[2] + direction[2] * this.distance,
    ];
  }

  /** The row-major view and projection matrices for a viewport aspect ratio. */
  matrices(aspect: number): { view: Mat4; proj: Mat4 } {
    const [right, up, forward] = this.axes();
    const eye = this.eye();
    const rows: Vec3[] = [right, up, [-forward[0], -forward[1], -forward[2]]];
    const view = [
      ...rows.flatMap((row) => [...row, -(row[0] * eye[0] + row[1] * eye[1] + row[2] * eye[2])]),
      0, 0, 0, 1,
    ];
    const near = Math.max(this.distance - 1.5 * this.radius, this.distance * 0.01);
    const far = this.distance + 1.5 * this.radius;
    const focal = 1 / Math.tan((FOV_DEGREES * DEG) / 2);
    const proj = [
      focal / Math.max(aspect, 1e-6), 0, 0, 0,
      0, focal, 0, 0,
      0, 0, -(far + near) / (far - near), (-2 * far * near) / (far - near),
      0, 0, -1, 0,
    ];
    return { view, proj };
  }

  /** The right, up and forward unit vectors of the view. */
  axes(): [Vec3, Vec3, Vec3] {
    const eye = this.eye();
    const forward = normalize([this.target[0] - eye[0], this.target[1] - eye[1], this.target[2] - eye[2]]);
    const right = normalize(cross(forward, [0, 0, 1]));
    const up = cross(right, forward);
    return [right, up, forward];
  }
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[r * 4 + k] as number) * (b[k * 4 + c] as number);
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

/** The column-major array that WebGL takes. */
export function columnMajor(matrix: Mat4): Float32Array {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = matrix[r * 4 + c] as number;
  return out;
}
