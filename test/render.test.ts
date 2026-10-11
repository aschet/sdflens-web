// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { Surface } from "../src/model";
import { Camera } from "../src/render/camera";
import { buildMesh, vertexPosition } from "../src/render/mesh";
import { pick, pickFace, pickVertex, project } from "../src/render/pick";
import { envelope, connect, lowerBound, positionEnvelope } from "../src/render/profile";
import { blockSize, reduce } from "../src/render/view2d";

function grid(rows: number, columns: number, height: (r: number, c: number) => number): Surface {
  const z = new Float32Array(rows * columns);
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) z[r * columns + c] = height(r, c);
  return { kind: "grid", rows, columns, stepX: 1e-6, stepY: 2e-6, z, x: null, y: null };
}

describe("mesh", () => {
  it("is right-handed, normalized and gives positions in meters", () => {
    const surface = grid(4, 6, (r, c) => (r * 6 + c) * 1e-9);
    const mesh = buildMesh(surface);
    expect(mesh.scale).toBeCloseTo(6e-6, 15); // the larger extent: 3 steps of 2 µm against 5 of 1 µm
    const [x0, y0, z0] = vertexPosition(mesh, 0);
    const [x1, y1, z1] = vertexPosition(mesh, 4 * 6 - 1);
    expect([x0, y0, z0]).toEqual([expect.closeTo(0, 12), expect.closeTo(0, 12), expect.closeTo(0, 12)]);
    expect(x1).toBeCloseTo(5e-6, 12);
    expect(y1).toBeCloseTo(6e-6, 12);
    expect(z1).toBeCloseTo(23e-9, 12);
    expect(mesh.vertices[0]).toBeLessThan(mesh.vertices[(4 * 6 - 1) * 3] as number);
  });

  it("leaves out the triangles and lines at points that are not measured", () => {
    const surface = grid(3, 3, () => 1e-9);
    surface.z[4] = NaN;
    const mesh = buildMesh(surface);
    expect(mesh.triangles.length).toBe(0); // all four cells touch the middle point
    expect(mesh.lines.length / 2).toBe(12 - 4);
    expect(mesh.valid[4]).toBe(0);
    expect(mesh.vertices.every(Number.isFinite)).toBe(true);
  });

  it("draws a profile as lines only", () => {
    const mesh = buildMesh(grid(1, 5, (_, c) => c * 1e-9));
    expect(mesh.triangles.length).toBe(0);
    expect(mesh.lines.length / 2).toBe(4);
  });

  it("makes triangles that face +z", () => {
    const mesh = buildMesh(grid(2, 2, () => 0));
    const v = mesh.vertices;
    const [a, b, c] = [mesh.triangles[0], mesh.triangles[1], mesh.triangles[2]] as [number, number, number];
    const ux = (v[b * 3] as number) - (v[a * 3] as number);
    const uy = (v[b * 3 + 1] as number) - (v[a * 3 + 1] as number);
    const wx = (v[c * 3] as number) - (v[a * 3] as number);
    const wy = (v[c * 3 + 1] as number) - (v[a * 3 + 1] as number);
    expect(ux * wy - uy * wx).toBeGreaterThan(0);
  });

  it("builds a cloud from positions", () => {
    const surface: Surface = {
      kind: "cloud", rows: 1, columns: 3, stepX: 0, stepY: 0,
      x: Float32Array.from([0, 1e-3, 2e-3]), y: Float32Array.from([0, 0, 1e-3]), z: Float32Array.from([0, 1e-6, 2e-6]),
    };
    const mesh = buildMesh(surface);
    expect(mesh.isCloud).toBe(true);
    expect(vertexPosition(mesh, 2)[0]).toBeCloseTo(2e-3, 9);
  });
});

describe("picking", () => {
  const camera = new Camera();
  const { view, proj } = camera.matrices(1);
  const size = 200;

  it("picks the nearest vertex within the radius and nothing far away", () => {
    const vertices = Float32Array.from([0, 0, 0, 0.05, 0, 0, 0.4, 0, 0]);
    const valid = new Uint8Array([1, 1, 1]);
    const projection = project(vertices, view, proj, 1, size, size);
    for (let i = 0; i < 3; i++) {
      expect(pickVertex(projection, valid, proj, size, (projection.x[i] as number) + 0.5, projection.y[i] as number, 6)).toBe(i);
    }
    expect(pickVertex(projection, valid, proj, size, (projection.x[2] as number) + 30, projection.y[2] as number, 6)).toBeNull();
  });

  it("does not pick points that are not measured", () => {
    const vertices = new Float32Array(6);
    const projection = project(vertices, view, proj, 1, size, size);
    expect(pickVertex(projection, new Uint8Array([0, 1]), proj, size, 100, 100, 6)).toBe(1);
    expect(pickVertex(projection, new Uint8Array([0, 0]), proj, size, 100, 100, 6)).toBeNull();
  });

  it("picks the nearest corner of the face under the cursor, far from any vertex", () => {
    const vertices = Float32Array.from([-0.3, -0.3, 0, 0.3, -0.3, 0, 0, 0.3, 0]);
    const triangles = Uint32Array.from([0, 1, 2]);
    const projection = project(vertices, view, proj, 1, size, size);
    const middle = [0, 1, 2].reduce((sum, i) => [sum[0]! + (projection.x[i] as number) / 3, sum[1]! + (projection.y[i] as number) / 3], [0, 0]) as [number, number];
    for (let corner = 0; corner < 3; corner++) {
      const x = middle[0] + 0.4 * ((projection.x[corner] as number) - middle[0]);
      const y = middle[1] + 0.4 * ((projection.y[corner] as number) - middle[1]);
      expect(Math.hypot(x - (projection.x[corner] as number), y - (projection.y[corner] as number))).toBeGreaterThan(6);
      expect(pickFace(projection, triangles, x, y)).toBe(corner);
      expect(pick(vertices, new Uint8Array(3).fill(1), triangles, view, proj, 1, x, y, size, size, 6)).toBe(corner);
    }
    expect(pickFace(projection, triangles, 5, 5)).toBeNull();
  });

  it("picks the face in front of one behind it", () => {
    const head = new Camera();
    head.setView(-90, 0);
    const matrices = head.matrices(1);
    const far = [-0.2, 0.3, -0.2, 0.2, 0.3, -0.2, 0, 0.3, 0.2];
    const near = [-0.2, -0.3, -0.2, 0.2, -0.3, -0.2, 0, -0.3, 0.2];
    const vertices = Float32Array.from([...far, ...near]);
    const projection = project(vertices, matrices.view, matrices.proj, 1, size, size);
    expect([3, 4, 5]).toContain(pickFace(projection, Uint32Array.from([0, 1, 2, 3, 4, 5]), 100, 100));
  });

  it("scales heights by the exaggeration", () => {
    const vertices = Float32Array.from([0, 0, 0.2]);
    const flat = project(vertices, view, proj, 1, size, size);
    const tall = project(vertices, view, proj, 3, size, size);
    expect(tall.y[0]).toBeLessThan(flat.y[0] as number);
  });
});

describe("camera", () => {
  it("needs more distance for a narrow view", () => {
    const wide = new Camera();
    const narrow = new Camera();
    wide.fit(1, 1.5);
    narrow.fit(1, 0.5);
    expect(narrow.distance).toBeGreaterThan(wide.distance);
  });

  it("limits the elevation and the zoom", () => {
    const camera = new Camera();
    camera.rotate(0, 1e6);
    expect(camera.elevation).toBe(89);
    camera.zoom(1e9);
    expect(camera.distance).toBeCloseTo(camera.radius * 0.05, 9);
  });
});

describe("profile and image helpers", () => {
  it("takes the lowest and highest value of each column and skips empty ones", () => {
    const values = Float32Array.from([1, 3, NaN, NaN, 2, 8]);
    const e = envelope(values, 0, 6, 3);
    expect([...e.columns]).toEqual([0, 2]);
    expect([...e.low]).toEqual([1, 2]);
    expect([...e.high]).toEqual([3, 8]);
    expect(envelope(values, 10, 12, 4).columns.length).toBe(0);
  });

  it("bins the points of an irregular profile by their positions", () => {
    const positions = Float32Array.from([0, 1, 9, 9.5]);
    const values = Float32Array.from([1, 2, 5, 7]);
    const e = positionEnvelope(values, positions, 0, 4, 0, 10, 2);
    expect([...e.columns]).toEqual([0, 1]);
    expect([...e.low]).toEqual([1, 5]);
    expect([...e.high]).toEqual([2, 7]);
    expect([lowerBound(positions, 1), lowerBound(positions, 5), lowerBound(positions, 11)]).toEqual([1, 2, 4]);
  });

  it("closes the gaps between adjacent columns only", () => {
    const { low, high } = connect(Int32Array.from([0, 1, 2, 4]), Float64Array.from([0, 5, 1, 9]), Float64Array.from([1, 6, 2, 9]));
    expect([...low]).toEqual([0, 2, 1, 9]);
    expect([...high]).toEqual([5, 6, 2, 9]);
  });

  it("averages blocks of measured points", () => {
    const data = Float32Array.from([1, 3, NaN, NaN, 5, 7, NaN, NaN]);
    expect([...reduce(data, 2, 4, 2, 2)]).toEqual([4, Number.NaN]);
    expect(blockSize(1, 100)).toBe(1);
    expect(blockSize(0.2, 100)).toBe(4);
    expect(blockSize(0.001, 8)).toBe(8);
  });
});
