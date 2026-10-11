// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** WebGL2 view of a mesh: colormapped, lit, with orbit, pan and zoom by mouse and touch, and picking. */

import { Camera, columnMajor } from './camera';
import { vertexPosition, type Mesh } from './mesh';
import { pick } from './pick';
import { formatLength } from '../units';

export type Tool = 'rotate' | 'pan' | 'zoom';
export type RenderMode = 'surface' | 'wireframe' | 'points';

export const Z_FACTOR_MIN = 0.01;
export const Z_FACTOR_MAX = 10000;

const ZOOM_STEP = 1.2;
const POINT_SIZE = 3;
const CLICK_DISTANCE = 4;
const PICK_RADIUS = 6;
const MARKER_RADIUS = 4.5;
const GIZMO_LENGTH = 30;
const GIZMO_HIT_RADIUS = 14;
const GIZMO_AXES = [
  { axis: 'x', label: 'X', color: '#e65a5a', view: [0, 0] },
  { axis: 'y', label: 'Y', color: '#6ed26e', view: [90, 0] },
  { axis: 'z', label: 'Z', color: '#6e96f0', view: [-90, 90] },
] as const;

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
uniform mat4 view;
uniform mat4 proj;
uniform vec3 params;
uniform vec2 colorMap;
out float vFraction;
out vec3 vViewPosition;
void main() {
  vFraction = position.z * colorMap.x + colorMap.y;
  vec4 viewPosition = view * vec4(position.xy, position.z * params.x, 1.0);
  vViewPosition = viewPosition.xyz;
  gl_Position = proj * viewPosition;
  gl_PointSize = params.z;
}`;

// Face normals come from screen-space derivatives: no per-vertex normals, so no NaN can leak in.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in float vFraction;
in vec3 vViewPosition;
uniform sampler2D lut;
uniform vec3 params;
out vec4 fragColor;
void main() {
  float u = clamp(vFraction, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0;
  vec3 base = texture(lut, vec2(u, 0.5)).rgb;
  if (params.y > 0.5) {
    vec3 normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
    vec3 light = normalize(vec3(-0.4, 0.5, 0.8));
    base *= 0.35 + 0.65 * abs(dot(normal, light));
  }
  fragColor = vec4(base, 1.0);
}`;

interface Pointer {
  x: number;
  y: number;
  button: number;
  type: string;
}

export class View3D {
  /** Called with the position of the picked point as text, empty when the click picks nothing. */
  onPick: (text: string) => void = () => undefined;

  private readonly canvas = document.createElement('canvas');
  private readonly overlay = document.createElement('canvas');
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly texture: WebGLTexture;
  private readonly camera = new Camera();
  private readonly observer: ResizeObserver;

  private mesh: Mesh | null = null;
  private zFactor = 1;
  private tool: Tool = 'rotate';
  private mode: RenderMode = 'surface';
  private drawMode = 0;
  private drawCount = 0;
  private geometryDirty = false;
  private picked: number | null = null;
  private frame = 0;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private background = '#1e1f22';

  private readonly pointers = new Map<number, Pointer>();
  private press: { x: number; y: number; moved: boolean } | null = null;
  private pinch: { distance: number; x: number; y: number } | null = null;

  constructor(private readonly host: HTMLElement) {
    this.canvas.className = 'gl';
    this.overlay.className = 'overlay';
    host.append(this.canvas, this.overlay);
    const gl = this.canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL 2 is not available in this browser');
    this.gl = gl;
    this.program = this.createProgram();
    this.uniforms = Object.fromEntries(
      ['view', 'proj', 'params', 'colorMap', 'lut'].map((name) => [
        name,
        gl.getUniformLocation(this.program, name),
      ]),
    );
    this.vao = gl.createVertexArray();
    this.vertexBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.overlay.style.touchAction = 'none';
    this.overlay.addEventListener('pointerdown', (event) => {
      this.onPointerDown(event);
    });
    this.overlay.addEventListener('pointermove', (event) => {
      this.onPointerMove(event);
    });
    this.overlay.addEventListener('pointerup', (event) => {
      this.onPointerUp(event);
    });
    this.overlay.addEventListener('pointercancel', (event) => {
      this.onPointerUp(event, true);
    });
    this.overlay.addEventListener(
      'wheel',
      (event) => {
        this.onWheel(event);
      },
      {
        passive: false,
      },
    );
    this.overlay.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });
    this.observer = new ResizeObserver(() => {
      this.resize();
    });
    this.observer.observe(host);
    this.resize();
  }

  setBackground(color: string): void {
    this.background = color;
    this.requestRender();
  }

  /** Shows ``mesh``; ``keepView`` keeps the camera, as when another layer of the same file is shown. */
  setMesh(mesh: Mesh | null, keepView = false): void {
    this.mesh = mesh;
    this.picked = null;
    this.geometryDirty = true;
    if (mesh) {
      // The view may have been hidden until now, so its size is measured again before the camera is fitted.
      this.resize();
      if (keepView) this.camera.setRadius(this.sceneRadius());
      else this.camera.fit(this.sceneRadius(), this.width / this.height);
    }
    this.requestRender();
  }

  setLut(lut: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB8,
      lut.length / 3,
      1,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      lut,
    );
    this.requestRender();
  }

  setZFactor(factor: number): void {
    this.zFactor = Math.min(
      Math.max(Number.isFinite(factor) ? factor : 1, Z_FACTOR_MIN),
      Z_FACTOR_MAX,
    );
    if (this.mesh) this.camera.setRadius(this.sceneRadius());
    this.requestRender();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
  }

  setRenderMode(mode: RenderMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.geometryDirty = true;
    this.requestRender();
  }

  home(): void {
    if (this.mesh) this.camera.fit(this.sceneRadius(), this.width / this.height);
    this.requestRender();
  }

  zoomIn(): void {
    this.camera.zoom(ZOOM_STEP);
    this.requestRender();
  }

  zoomOut(): void {
    this.camera.zoom(1 / ZOOM_STEP);
    this.requestRender();
  }

  /** The rendered view, with the axes, as a PNG. */
  snapshot(): Promise<Blob> {
    this.render();
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const context = out.getContext('2d') as CanvasRenderingContext2D;
    context.drawImage(this.canvas, 0, 0);
    context.drawImage(this.overlay, 0, 0);
    return new Promise((resolve, reject) => {
      out.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('No image'));
      }, 'image/png');
    });
  }

  dispose(): void {
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    this.canvas.remove();
    this.overlay.remove();
  }

  private sceneRadius(): number {
    const mesh = this.mesh;
    if (!mesh) return 1;
    const height = mesh.heightFraction * this.zFactor;
    return 0.5 * Math.hypot(mesh.extent[0], mesh.extent[1], height);
  }

  private createProgram(): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX_SHADER],
      [gl.FRAGMENT_SHADER, FRAGMENT_SHADER],
    ] as const) {
      const shader = gl.createShader(type) as WebGLShader;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(`Shader error: ${gl.getShaderInfoLog(shader)}`);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`Shader error: ${gl.getProgramInfoLog(program)}`);
    return program;
  }

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    this.ratio = window.devicePixelRatio || 1;
    this.width = Math.max(Math.round(rect.width), 1);
    this.height = Math.max(Math.round(rect.height), 1);
    for (const canvas of [this.canvas, this.overlay]) {
      canvas.width = Math.round(this.width * this.ratio);
      canvas.height = Math.round(this.height * this.ratio);
    }
    this.requestRender();
  }

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const [r, g, b] = parseColor(this.background);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.uploadGeometry();
    if (this.mesh && this.drawCount > 0) this.drawGeometry(this.mesh);
    this.drawOverlay();
  }

  private uploadGeometry(): void {
    if (!this.geometryDirty) return;
    this.geometryDirty = false;
    const gl = this.gl;
    const mesh = this.mesh;
    let indices: Uint32Array = new Uint32Array(0);
    if (mesh) {
      if (this.mode === 'points' || mesh.isCloud) {
        this.drawMode = gl.POINTS;
        const measured: number[] = [];
        mesh.valid.forEach((flag, i) => flag && measured.push(i));
        indices = Uint32Array.from(measured);
      } else if (this.mode === 'surface' && mesh.triangles.length) {
        this.drawMode = gl.TRIANGLES;
        indices = mesh.triangles;
      } else {
        this.drawMode = gl.LINES;
        indices = mesh.lines;
      }
    }
    this.drawCount = indices.length;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      mesh ? mesh.vertices : new Float32Array(0),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  private drawGeometry(mesh: Mesh): void {
    const gl = this.gl;
    const { view, proj } = this.camera.matrices(this.width / this.height);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(
      this.uniforms.view as WebGLUniformLocation,
      false,
      columnMajor(view),
    );
    gl.uniformMatrix4fv(
      this.uniforms.proj as WebGLUniformLocation,
      false,
      columnMajor(proj),
    );
    const lit = this.drawMode === gl.TRIANGLES ? 1 : 0;
    gl.uniform3f(
      this.uniforms.params as WebGLUniformLocation,
      this.zFactor,
      lit,
      POINT_SIZE * this.ratio,
    );
    const range = mesh.zMax - mesh.zMin;
    gl.uniform2f(
      this.uniforms.colorMap as WebGLUniformLocation,
      range > 0 ? mesh.scale / range : 0,
      0.5,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.lut as WebGLUniformLocation, 0);
    gl.bindVertexArray(this.vao);
    gl.drawElements(this.drawMode, this.drawCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }

  // ---------------------------------------------------------------------------------------------- overlay

  private gizmoOrigin(): [number, number] {
    return [48, this.height - 48];
  }

  private gizmoTips(): { axis: (typeof GIZMO_AXES)[number]; x: number; y: number }[] {
    const { view } = this.camera.matrices(1);
    const [ox, oy] = this.gizmoOrigin();
    return GIZMO_AXES.map((axis, column) => ({
      axis,
      x: ox + (view[column] as number) * GIZMO_LENGTH,
      y: oy - (view[4 + column] as number) * GIZMO_LENGTH,
    }));
  }

  private drawOverlay(): void {
    const context = this.overlay.getContext('2d') as CanvasRenderingContext2D;
    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    if (!this.mesh) return;
    const [ox, oy] = this.gizmoOrigin();
    context.font = 'bold 12px system-ui, sans-serif';
    context.lineWidth = 2;
    context.lineCap = 'round';
    for (const { axis, x, y } of this.gizmoTips()) {
      const dx = (x - ox) / GIZMO_LENGTH;
      const dy = (y - oy) / GIZMO_LENGTH;
      context.strokeStyle = axis.color;
      context.fillStyle = axis.color;
      context.beginPath();
      context.moveTo(ox, oy);
      context.lineTo(x, y);
      context.stroke();
      context.fillText(axis.label, x + dx * 8 - 4, y + dy * 8 + 4);
    }
    if (this.picked !== null) {
      const { view, proj } = this.camera.matrices(this.width / this.height);
      const spot = projectOne(
        this.mesh,
        this.picked,
        view,
        proj,
        this.zFactor,
        this.width,
        this.height,
      );
      if (spot) {
        context.beginPath();
        context.arc(spot[0], spot[1], MARKER_RADIUS, 0, Math.PI * 2);
        context.fillStyle = '#e67814';
        context.fill();
        context.lineWidth = 1.5;
        context.strokeStyle = this.background;
        context.stroke();
      }
    }
  }

  private axisAt(x: number, y: number): (typeof GIZMO_AXES)[number] | null {
    if (!this.mesh) return null;
    let nearest: (typeof GIZMO_AXES)[number] | null = null;
    let distance = GIZMO_HIT_RADIUS;
    for (const tip of this.gizmoTips()) {
      const d = Math.hypot(x - tip.x, y - tip.y);
      if (d <= distance) {
        nearest = tip.axis;
        distance = d;
      }
    }
    return nearest;
  }

  // ----------------------------------------------------------------------------------------- interaction

  private local(event: PointerEvent): { x: number; y: number } {
    const rect = this.overlay.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown(event: PointerEvent): void {
    const { x, y } = this.local(event);
    this.overlay.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, {
      x,
      y,
      button: event.button,
      type: event.pointerType,
    });
    if (this.pointers.size === 1) {
      const axis = event.button === 0 ? this.axisAt(x, y) : null;
      if (axis) {
        this.camera.setView(axis.view[0], axis.view[1]);
        this.requestRender();
        this.pointers.delete(event.pointerId);
        return;
      }
      this.press = { x, y, moved: false };
    } else {
      this.press = null;
      this.pinch = this.pinchState();
    }
  }

  private pinchState(): { distance: number; x: number; y: number } | null {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return null;
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  }

  private onPointerMove(event: PointerEvent): void {
    const { x, y } = this.local(event);
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      this.overlay.style.cursor = this.axisAt(x, y) ? 'pointer' : '';
      return;
    }
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    pointer.x = x;
    pointer.y = y;
    if (this.pointers.size >= 2) {
      const now = this.pinchState();
      if (now && this.pinch && this.pinch.distance > 0) {
        this.camera.zoom(now.distance / this.pinch.distance);
        this.camera.pan(now.x - this.pinch.x, now.y - this.pinch.y, this.height);
      }
      this.pinch = now;
      this.requestRender();
      return;
    }
    if (this.press && Math.hypot(x - this.press.x, y - this.press.y) > CLICK_DISTANCE)
      this.press.moved = true;
    let tool = this.tool;
    if (pointer.type === 'mouse') {
      if (pointer.button === 1) tool = 'pan';
      else if (pointer.button === 2) tool = 'zoom';
    }
    if (tool === 'rotate') this.camera.rotate(dx, dy);
    else if (tool === 'pan') this.camera.pan(dx, dy, this.height);
    else this.camera.zoom(Math.exp(-dy * 0.01));
    this.requestRender();
  }

  private onPointerUp(event: PointerEvent, cancelled = false): void {
    const pointer = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const press = this.press;
    if (this.pointers.size === 0) this.press = null;
    if (cancelled || !pointer || !press || press.moved || pointer.button !== 0) return;
    this.pick(press.x, press.y);
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 33 : 1);
    this.camera.zoom(ZOOM_STEP ** (-delta / 100));
    this.requestRender();
  }

  private pick(x: number, y: number): void {
    const mesh = this.mesh;
    if (!mesh) return;
    const { view, proj } = this.camera.matrices(this.width / this.height);
    this.picked = pick(
      mesh.vertices,
      mesh.valid,
      mesh.triangles,
      view,
      proj,
      this.zFactor,
      x,
      y,
      this.width,
      this.height,
      PICK_RADIUS,
    );
    this.requestRender();
    if (this.picked === null) {
      this.onPick('');
      return;
    }
    const [px, py, pz] = vertexPosition(mesh, this.picked);
    this.onPick(`x=${formatLength(px)}, y=${formatLength(py)}, z=${formatLength(pz)}`);
  }
}

function projectOne(
  mesh: Mesh,
  index: number,
  view: number[],
  proj: number[],
  zFactor: number,
  width: number,
  height: number,
): [number, number] | null {
  const px = mesh.vertices[index * 3] as number;
  const py = mesh.vertices[index * 3 + 1] as number;
  const pz = (mesh.vertices[index * 3 + 2] as number) * zFactor;
  const eye = [0, 1, 2, 3].map(
    (r) =>
      (view[r * 4] as number) * px +
      (view[r * 4 + 1] as number) * py +
      (view[r * 4 + 2] as number) * pz +
      (view[r * 4 + 3] as number),
  );
  const clip = [0, 1, 2, 3].map(
    (r) =>
      (proj[r * 4] as number) * (eye[0] as number) +
      (proj[r * 4 + 1] as number) * (eye[1] as number) +
      (proj[r * 4 + 2] as number) * (eye[2] as number) +
      (proj[r * 4 + 3] as number) * (eye[3] as number),
  );
  const w = clip[3] as number;
  if (w <= 0) return null;
  return [
    ((clip[0] as number) / w + 1) * 0.5 * width,
    (1 - (clip[1] as number) / w) * 0.5 * height,
  ];
}

/** The red, green and blue of a CSS color in #rgb or #rrggbb form, in [0, 1]. */
export function parseColor(color: string): [number, number, number] {
  let hex = color.trim().replace('#', '');
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const value = parseInt(hex, 16);
  if (hex.length !== 6 || Number.isNaN(value)) return [0.12, 0.12, 0.13];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
