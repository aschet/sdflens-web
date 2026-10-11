// SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import "./style.css";
import { buildLut, colormapNames, DEFAULT_COLORMAP } from "./colormap";
import { readFile } from "./formats";
import { FormatError, statistics, type InfoSection, type Stats, type Surface, type SurfaceFile } from "./model";
import { buildMesh, type Mesh } from "./render/mesh";
import { ProfilePlot } from "./render/profile";
import { View2D } from "./render/view2d";
import { View3D, Z_FACTOR_MAX, Z_FACTOR_MIN, type RenderMode, type Tool } from "./render/view3d";
import { SAMPLES } from "./samples";
import { Colorbar } from "./ui/colorbar";
import { formatLength } from "./units";

type ViewName = "3d" | "2d" | "profile";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const app = $("app");

const state = {
  file: null as SurfaceFile | null,
  layer: 0,
  surface: null as Surface | null,
  stats: null as Stats | null,
  mesh: null as Mesh | null,
  view: "3d" as ViewName,
  colormap: DEFAULT_COLORMAP,
  reverse: false,
  mode: "surface" as RenderMode,
  zFactor: 1,
  tool: "rotate" as Tool,
  profileAxis: "x" as "x" | "y",
  profileIndex: 0,
  meshKeepView: false,
};

let view3d: View3D | null = null;
let view2d: View2D | null = null;
let profile: ProfilePlot | null = null;
let webglProblem: string | null = null;
const colorbar = new Colorbar($<HTMLCanvasElement>("colorbar"));

// ------------------------------------------------------------------------------------------------ theme

function cssColors(): { background: string; foreground: string; muted: string; surface: string; border: string } {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  return { background: read("--stage"), foreground: read("--text"), muted: read("--muted"), surface: read("--surface"), border: read("--border") };
}

function applyColors(): void {
  const colors = cssColors();
  view3d?.setBackground(colors.background);
  view2d?.setStyle(colors);
  profile?.setStyle(colors);
  colorbar.setColors(colors.foreground);
}

function setTheme(theme: "light" | "dark" | null): void {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  try {
    if (theme) localStorage.setItem("theme", theme);
  } catch {
    // The choice is not remembered where storage is blocked.
  }
  applyColors();
}

try {
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch {
  // Storage may be blocked.
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyColors);
/** The theme in use: the one chosen with the button, otherwise the one the system prefers. */
function currentTheme(): "light" | "dark" {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

$("themeButton").addEventListener("click", () => setTheme(currentTheme() === "dark" ? "light" : "dark"));

// ------------------------------------------------------------------------------------------------ views

function ensureView3d(): View3D | null {
  if (view3d || webglProblem) return view3d;
  try {
    view3d = new View3D($("view3d"));
  } catch (error) {
    webglProblem = error instanceof Error ? error.message : "WebGL 2 is not available";
    return null;
  }
  view3d.onPick = (text) => showReadout(text);
  view3d.setLut(currentLut());
  view3d.setZFactor(state.zFactor);
  view3d.setRenderMode(state.mode);
  view3d.setTool(state.tool);
  applyColors();
  return view3d;
}

function ensureView2d(): View2D {
  if (!view2d) {
    view2d = new View2D($("view2d"));
    view2d.onHover = (text) => showReadout(text);
    view2d.setLut(currentLut());
    view2d.setTool(state.tool);
    applyColors();
  }
  return view2d;
}

function ensureProfile(): ProfilePlot {
  if (!profile) {
    profile = new ProfilePlot($("viewProfile"));
    profile.onHover = (index) => showReadout(profileText(index));
    applyColors();
  }
  return profile;
}

function currentLut(): Uint8Array {
  return buildLut(state.colormap, state.reverse);
}

/** The views that can show the surface of the file. */
function available(): Record<ViewName, string | null> {
  const s = state.surface;
  if (!s) return { "3d": "No file", "2d": "No file", profile: "No file" };
  const regular = s.kind === "grid" && s.x === null;
  return {
    "3d": webglProblem,
    "2d": regular && s.rows > 1 && s.columns > 1 ? null : "Needs a surface on a regular grid",
    profile: regular ? null : "Needs a profile or a surface on a regular grid",
  };
}

function setView(name: ViewName): void {
  const reasons = available();
  if (name === "3d") ensureView3d();
  if (reasons[name] !== null || (name === "3d" && !view3d)) {
    const reason = name === "3d" ? webglProblem ?? reasons["3d"] : reasons[name];
    if (reason) toast(reason);
    return;
  }
  state.view = name;
  app.dataset.view = name;
  $("view3d").hidden = name !== "3d";
  $("view2d").hidden = name !== "2d";
  $("viewProfile").hidden = name !== "profile";
  for (const button of document.querySelectorAll<HTMLButtonElement>(".views button")) {
    button.setAttribute("aria-selected", String(button.dataset.view === name));
  }
  if (name === "3d") {
    ensureMesh();
  } else if (name === "2d") {
    ensureView2d();
    feed2d(false);
  } else {
    ensureProfile();
    updateProfile();
  }
  $("colorbarBox").hidden = name === "profile" || state.file === null;
  colorbar.draw();
  $("profileBar").hidden = name !== "profile";
  $("modeField").hidden = name !== "3d";
  $("zField").hidden = name !== "3d";
  $("zReset").hidden = name !== "3d";
  updateTools();
  updateAvailability();
  showReadout("");
}

function updateAvailability(): void {
  const reasons = available();
  for (const button of document.querySelectorAll<HTMLButtonElement>(".views button")) {
    const reason = reasons[button.dataset.view as ViewName];
    button.disabled = reason !== null && button.dataset.view !== "3d";
    // The icon has no text, so the title says what the view is, and why it is not available.
    button.dataset.title ??= button.title;
    button.title = reason ? `${button.dataset.title}: ${reason}` : button.dataset.title;
  }
}

function effectiveTool(): Tool {
  return state.view !== "3d" && state.tool === "rotate" ? "pan" : state.tool;
}

function updateTools(): void {
  const effective = effectiveTool();
  for (const button of document.querySelectorAll<HTMLButtonElement>(".tool[data-tool]")) {
    const tool = button.dataset.tool as Tool;
    // Rotating is for the 3D view only.
    button.hidden = tool === "rotate" && state.view !== "3d";
    button.setAttribute("aria-pressed", String(tool === effective));
  }
  view3d?.setTool(state.tool);
  view2d?.setTool(effective);
  profile?.setTool(effective === "zoom" ? "zoom" : "pan");
}

function ensureMesh(): void {
  const view = ensureView3d();
  if (!view || !state.surface) return;
  if (!state.mesh) {
    state.mesh = buildMesh(state.surface);
    view.setMesh(state.mesh, state.meshKeepView);
    state.meshKeepView = false;
  }
}

// -------------------------------------------------------------------------------------------- loading

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function setBusy(text: string | null): void {
  $("busy").hidden = text === null;
  if (text !== null) $("busyText").textContent = text;
}

let toastTimer = 0;
function toast(message: string): void {
  const element = $("toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (element.hidden = true), 7000);
}

async function openBytes(bytes: Uint8Array, name: string): Promise<void> {
  setBusy(`Reading ${name}`);
  await nextPaint();
  try {
    const file = readFile(bytes, name);
    state.file = file;
    state.layer = 0;
    loadLayer(0, false);
    app.dataset.state = "loaded";
    $("fileName").textContent = name;
    $("fileName").title = name;
    document.title = `${name} · sdflens web`;
    const reasons = available();
    const profileOnly = state.surface !== null && state.surface.kind === "grid" && state.surface.rows === 1;
    setView(profileOnly && reasons.profile === null ? "profile" : reasons["3d"] === null ? "3d" : reasons["2d"] === null ? "2d" : "profile");
  } catch (error) {
    toast(error instanceof FormatError ? `${name}: ${error.message}` : `${name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(null);
  }
}

/** Decodes a layer of the open file and passes it to the views. */
function loadLayer(index: number, keepView: boolean): void {
  const file = state.file as SurfaceFile;
  const surface = file.layer(index);
  const stats = statistics(surface);
  if (stats.measured === 0) throw new FormatError("The file contains no measured points");
  state.layer = index;
  state.surface = surface;
  state.stats = stats;
  state.mesh = null;
  state.meshKeepView = keepView;
  if (!keepView) {
    state.profileAxis = "x";
    state.profileIndex = Math.floor(surface.rows / 2);
    markAxis();
  }
  if (view3d) view3d.setMesh(null);
  colorbar.update(currentLut(), [stats.min, stats.max]);
  const layers = file.layerCount;
  $("layerBar").hidden = layers < 2;
  app.dataset.layers = layers < 2 ? "one" : "many";
  $("layerLabel").textContent = `Layer ${index + 1} / ${layers}`;
  renderInfo();
  if (app.dataset.state === "loaded") {
    if (state.view === "3d") ensureMesh();
    else if (state.view === "2d") feed2d(keepView);
    else updateProfile();
  }
  updateAvailability();
  showReadout("");
}

function feed2d(keepView: boolean): void {
  const s = state.surface;
  const stats = state.stats;
  if (!s || !stats || !view2d) return;
  const regular = s.kind === "grid" && s.x === null;
  view2d.setSurface(regular ? s : null, [stats.min, stats.max], keepView);
}

// ------------------------------------------------------------------------------------------ profile

function profileSeries(): { values: Float32Array; step: number; count: number } {
  const s = state.surface as Surface;
  if (state.profileAxis === "x") {
    const row = Math.min(state.profileIndex, s.rows - 1);
    return { values: s.z.slice(row * s.columns, (row + 1) * s.columns), step: s.stepX, count: s.rows };
  }
  const column = Math.min(state.profileIndex, s.columns - 1);
  const values = new Float32Array(s.rows);
  for (let r = 0; r < s.rows; r++) values[r] = s.z[r * s.columns + column] as number;
  return { values, step: s.stepY, count: s.columns };
}

function updateProfile(): void {
  const s = state.surface;
  if (!s || s.kind !== "grid" || s.x !== null) return;
  const plot = ensureProfile();
  const { values, step, count } = profileSeries();
  plot.setSeries(values, step, state.profileAxis);
  const slider = $("profileSlider") as HTMLInputElement;
  slider.max = String(count);
  slider.value = String(state.profileIndex + 1);
  const noun = state.profileAxis === "x" ? "Profile" : "Column";
  $("profileLabel").textContent = `${state.profileIndex + 1} / ${count}`;
  slider.setAttribute("aria-label", noun);
  // A profile has no columns to choose along y.
  ($("profileDirection").querySelector('[data-axis="y"]') as HTMLButtonElement).disabled = s.rows < 2;
  ($("profileBar") as HTMLElement).dataset.noun = noun;
}

function profileText(index: number): string {
  if (index < 0 || !profile || !state.surface) return "";
  const value = profile.valueAt(index);
  const { step } = profileSeries();
  const z = Number.isFinite(value) ? formatLength(value) : "not measured";
  const along = state.profileAxis === "x";
  return `${along ? "x" : "y"} = ${formatLength(index * step)}, z = ${z}`;
}

function markAxis(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("#profileDirection button")) {
    button.setAttribute("aria-pressed", String(button.dataset.axis === state.profileAxis));
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("#profileDirection button")) {
  button.addEventListener("click", () => {
    state.profileAxis = button.dataset.axis === "y" ? "y" : "x";
    const s = state.surface as Surface;
    state.profileIndex = Math.floor((state.profileAxis === "x" ? s.rows : s.columns) / 2);
    markAxis();
    updateProfile();
  });
}
$("profileSlider").addEventListener("input", (event) => {
  state.profileIndex = Number((event.target as HTMLInputElement).value) - 1;
  updateProfile();
});

// ----------------------------------------------------------------------------------------- information

function renderInfo(): void {
  const body = $("infoBody");
  body.replaceChildren();
  const file = state.file;
  const stats = state.stats;
  const s = state.surface;
  if (!file || !stats || !s) return;
  const layer: InfoSection = {
    title: file.layerCount > 1 ? `Layer ${state.layer + 1}` : "Heights",
    rows: [
      ["Lowest", formatLength(stats.min)],
      ["Highest", formatLength(stats.max)],
      ["Range", formatLength(stats.max - stats.min)],
      ["Measured points", stats.measured.toLocaleString("en")],
      ["Not measured", stats.invalid.toLocaleString("en")],
    ],
  };
  for (const section of [...file.info, layer]) {
    const heading = document.createElement("h3");
    heading.textContent = section.title;
    const list = document.createElement("dl");
    for (const [label, value] of section.rows) {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      list.append(term, description);
    }
    body.append(heading, list);
  }
}

const isHidden = (id: string): boolean => $(id).hidden !== false;

function setPanel(id: "display" | "drawer", open: boolean): void {
  const panel = $(id);
  panel.hidden = !open;
  const button = $(id === "display" ? "displayButton" : "infoButton");
  button.setAttribute("aria-expanded", String(open));
  if (open && id === "display") $("drawer").hidden = true, $("infoButton").setAttribute("aria-expanded", "false");
  if (open && id === "drawer") $("display").hidden = true, $("displayButton").setAttribute("aria-expanded", "false");
}

$("displayButton").addEventListener("click", () => setPanel("display", isHidden("display")));
$("infoButton").addEventListener("click", () => setPanel("drawer", isHidden("drawer")));

// ---------------------------------------------------------------------------------------------- display

const colormapSelect = $("colormapSelect") as HTMLSelectElement;
for (const name of colormapNames()) colormapSelect.add(new Option(name, name));
colormapSelect.value = state.colormap;

function applyColormap(): void {
  const lut = currentLut();
  view3d?.setLut(lut);
  view2d?.setLut(lut);
  if (state.stats) colorbar.update(lut, [state.stats.min, state.stats.max]);
}

colormapSelect.addEventListener("change", () => {
  state.colormap = colormapSelect.value;
  applyColormap();
});
$("reverseCheck").addEventListener("change", (event) => {
  state.reverse = (event.target as HTMLInputElement).checked;
  applyColormap();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("#modeButtons button")) {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode as RenderMode;
    for (const other of document.querySelectorAll<HTMLButtonElement>("#modeButtons button")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
    view3d?.setRenderMode(state.mode);
  });
}

const zSlider = $("zSlider") as HTMLInputElement;
const SLIDER_MAX = 1000;
const logMin = Math.log10(Z_FACTOR_MIN);
const logMax = Math.log10(Z_FACTOR_MAX);
const sliderToFactor = (position: number): number => 10 ** (logMin + (position / SLIDER_MAX) * (logMax - logMin));
const factorToSlider = (factor: number): number => Math.round(((Math.log10(factor) - logMin) / (logMax - logMin)) * SLIDER_MAX);

function setZFactor(factor: number): void {
  state.zFactor = Math.min(Math.max(factor, Z_FACTOR_MIN), Z_FACTOR_MAX);
  zSlider.value = String(factorToSlider(state.zFactor));
  $("zOutput").textContent = `×${Number(state.zFactor.toPrecision(3))}`;
  view3d?.setZFactor(state.zFactor);
}

zSlider.addEventListener("input", () => {
  // Close to true scale the slider snaps to 1, so that it is easy to return to.
  let factor = sliderToFactor(Number(zSlider.value));
  if (Math.abs(Math.log10(factor)) < 0.03) factor = 1;
  setZFactor(factor);
});
$("zReset").addEventListener("click", () => setZFactor(1));
setZFactor(1);

// ------------------------------------------------------------------------------------------------ tools

for (const button of document.querySelectorAll<HTMLButtonElement>(".tool[data-tool]")) {
  button.addEventListener("click", () => {
    state.tool = button.dataset.tool as Tool;
    updateTools();
  });
}

function activeView(): { home(): void; zoomIn(): void; zoomOut(): void; snapshot(): Promise<Blob> } | null {
  return state.view === "3d" ? view3d : state.view === "2d" ? view2d : profile;
}
$("homeButton").addEventListener("click", () => activeView()?.home());
$("zoomInButton").addEventListener("click", () => activeView()?.zoomIn());
$("zoomOutButton").addEventListener("click", () => activeView()?.zoomOut());

for (const button of document.querySelectorAll<HTMLButtonElement>(".views button")) {
  button.addEventListener("click", () => setView(button.dataset.view as ViewName));
}

$("layerPrev").addEventListener("click", () => stepLayer(-1));
$("layerNext").addEventListener("click", () => stepLayer(1));

function stepLayer(delta: number): void {
  const file = state.file;
  if (!file || file.layerCount < 2) return;
  const next = (state.layer + delta + file.layerCount) % file.layerCount;
  try {
    loadLayer(next, true);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}

/** The picture of the view, with the color bar: over the picture in 3D, next to it in 2D. */
async function screenshot(view: { snapshot(): Promise<Blob> }, host: HTMLElement): Promise<Blob> {
  const picture = await view.snapshot();
  const bar = $("colorbarBox");
  if (bar.hidden !== false) return picture;
  const image = await createImageBitmap(picture);
  const hostRect = host.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  const ratio = image.width / hostRect.width;
  const left = Math.min(hostRect.left, barRect.left);
  const top = Math.min(hostRect.top, barRect.top);
  const width = Math.max(hostRect.right, barRect.right) - left;
  const height = Math.max(hostRect.bottom, barRect.bottom) - top;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  const colors = cssColors();
  context.fillStyle = colors.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, (hostRect.left - left) * ratio, (hostRect.top - top) * ratio);
  const x = (barRect.left - left) * ratio;
  const y = (barRect.top - top) * ratio;
  context.beginPath();
  context.roundRect(x, y, barRect.width * ratio, barRect.height * ratio, 10 * ratio);
  context.fillStyle = colors.surface;
  context.fill();
  context.strokeStyle = colors.border;
  context.lineWidth = ratio;
  context.stroke();
  context.drawImage($<HTMLCanvasElement>("colorbar"), x, y, barRect.width * ratio, barRect.height * ratio);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No image"))), "image/png"));
}

$("shotButton").addEventListener("click", async () => {
  const view = activeView();
  if (!view || !state.file) return;
  const host = $(state.view === "3d" ? "view3d" : state.view === "2d" ? "view2d" : "viewProfile");
  const blob = await screenshot(view, host);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.file.name.replace(/\.[^.]+$/, "")}-${state.view}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
});

// --------------------------------------------------------------------------------------- readout

function showReadout(text: string): void {
  const element = $("readout");
  const stats = state.stats;
  const s = state.surface;
  if (text) {
    element.textContent = text;
    element.classList.add("live");
    return;
  }
  element.classList.remove("live");
  if (!s || !stats) {
    element.textContent = "";
    return;
  }
  const size = s.kind === "cloud" ? `${s.columns.toLocaleString("en")} points` : s.rows === 1 ? `${s.columns.toLocaleString("en")} points` : `${s.columns.toLocaleString("en")} × ${s.rows.toLocaleString("en")} points`;
  const hint = state.view === "3d" ? "Click the surface to read a point" : state.view === "2d" ? "Move over the image to read a point" : "Move over the plot to read a point";
  element.textContent = `${size}${stats.invalid ? `, ${stats.invalid.toLocaleString("en")} not measured` : ""} · ${hint}`;
}

// ------------------------------------------------------------------------------------------ opening files

const fileInput = $("fileInput") as HTMLInputElement;
const choose = (): void => fileInput.click();
$("openButton").addEventListener("click", choose);
$("landingOpen").addEventListener("click", choose);

async function openFile(file: File): Promise<void> {
  setBusy(`Reading ${file.name}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await openBytes(bytes, file.name);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void openFile(file);
  fileInput.value = "";
});

let dragDepth = 0;
window.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  dragDepth++;
  $("dropHint").hidden = false;
});
window.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(dragDepth - 1, 0);
  if (dragDepth === 0) $("dropHint").hidden = true;
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("dropHint").hidden = true;
  const file = event.dataTransfer?.files[0];
  if (file) void openFile(file);
});

for (const sample of SAMPLES) {
  const button = document.createElement("button");
  button.className = "button";
  button.textContent = `${sample.title} · ${sample.kind}`;
  button.addEventListener("click", async () => {
    setBusy(`Reading ${sample.file}`);
    try {
      const response = await fetch(sample.url);
      await openBytes(new Uint8Array(await response.arrayBuffer()), sample.file);
    } catch (error) {
      setBusy(null);
      toast(error instanceof Error ? error.message : String(error));
    }
  });
  $("sampleList").append(button);
}

applyColors();
