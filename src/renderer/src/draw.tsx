import {
  ArrowUpRight,
  Circle,
  Eraser,
  Hand,
  Minus,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { getStroke } from "perfect-freehand";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, PointerEvent, ReactNode } from "react";

import darkIcon from "@/assets/dock-dark.png";
import lightIcon from "@/assets/dock-light.png";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { defaultSettings } from "../../shared/types";
import type { Settings } from "../../shared/types";

type Point = [number, number, number];
type XY = [number, number];
type Tool =
  | "arrow"
  | "box"
  | "circle"
  | "eraser"
  | "hand"
  | "line"
  | "pen"
  | "select"
  | "text";
type Handle = "a" | "b" | "e" | "n" | "ne" | "nw" | "s" | "se" | "sw" | "w";
interface Bounds {
  h: number;
  w: number;
  x: number;
  y: number;
}

interface PenMark {
  color: string;
  id: string;
  kind: "pen";
  points: Point[];
  size: number;
}

interface PairMark {
  a: XY;
  b: XY;
  color: string;
  id: string;
  kind: "arrow" | "box" | "circle" | "line";
  size: number;
}

interface TextMark {
  color: string;
  id: string;
  kind: "text";
  size: number;
  text: string;
  x: number;
  y: number;
}

type Mark = PairMark | PenMark | TextMark;
type Drag =
  | {
      at: XY;
      box: Bounds;
      handle: Handle;
      id: string;
      kind: "resize";
      marks: Mark[];
    }
  | { at: XY; id: string; kind: "move"; marks: Mark[] }
  | { at: XY; kind: "pan"; pan: XY };

interface TextDraft {
  color: string;
  id?: string;
  size: number;
  text: string;
  x: number;
  y: number;
}

interface Swatch {
  dark: string;
  id: string;
  light: string;
}

const OPTIONS = {
  smoothing: 0.5,
  streamline: 0.55,
  thinning: 0.55,
};

const ERASE_R = 16;
const SIZES = [2.25, 3.5, 6] as const;
const FONT_PX = [14, 18, 26] as const;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const SELECT = "#4c6fff";
const HANDLE = 10;
// ponytail: cap snapshots, raise if long sessions matter
const UNDO_MAX = 32;
const PNG_MAX = 4096;

const PALETTE: Swatch[] = [
  { dark: "#eceae4", id: "ink", light: "#1c1917" },
  { dark: "#f87171", id: "red", light: "#dc2626" },
  { dark: "#fbbf24", id: "amber", light: "#d97706" },
  { dark: "#4ade80", id: "green", light: "#16a34a" },
  { dark: "#60a5fa", id: "blue", light: "#2563eb" },
  { dark: "#c084fc", id: "violet", light: "#7c3aed" },
];

const TOOLS: { icon: typeof Pencil; id: Tool; key: string; label: string }[] = [
  { icon: MousePointer2, id: "select", key: "v", label: "Select" },
  { icon: Hand, id: "hand", key: "h", label: "Hand" },
  { icon: Pencil, id: "pen", key: "p", label: "Pen" },
  { icon: Eraser, id: "eraser", key: "e", label: "Eraser" },
  { icon: Minus, id: "line", key: "l", label: "Line" },
  { icon: ArrowUpRight, id: "arrow", key: "a", label: "Arrow" },
  { icon: Square, id: "box", key: "r", label: "Box" },
  { icon: Circle, id: "circle", key: "o", label: "Circle" },
  { icon: Type, id: "text", key: "t", label: "Text" },
];

const TOOL_BY_KEY = Object.fromEntries(
  TOOLS.map((item) => [item.key, item.id])
) as Record<string, Tool>;

const mid = (a: number, b: number): number => (a + b) / 2;

const token = (name: string, fallback: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
  fallback;

const paper = (): string => token("--background", "#fff");

const swatchHex = (id: string, dark: boolean): string => {
  const item = PALETTE.find((row) => row.id === id);
  if (!item) {
    return dark ? "#eceae4" : "#1c1917";
  }
  return dark ? item.dark : item.light;
};

const penWidth = (size: number): number => size * 3 + 2;

const fontPx = (size: number): number => {
  if (size >= SIZES[2]) {
    return FONT_PX[2];
  }
  if (size >= SIZES[1]) {
    return FONT_PX[1];
  }
  return FONT_PX[0];
};

const pathOf = (points: Point[], size: number): string => {
  const outline = getStroke(points, { ...OPTIONS, size: penWidth(size) });
  if (outline.length < 4) {
    return "";
  }
  const [a, b, c] = outline;
  if (a === undefined || b === undefined || c === undefined) {
    return "";
  }
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${mid(b[0], c[0]).toFixed(2)},${mid(b[1], c[1]).toFixed(2)} T`;
  for (let i = 2; i < outline.length - 1; i += 1) {
    const cur = outline[i];
    const next = outline[i + 1];
    if (cur === undefined || next === undefined) {
      continue;
    }
    d += `${mid(cur[0], next[0]).toFixed(2)},${mid(cur[1], next[1]).toFixed(2)} `;
  }
  return `${d}Z`;
};

const pointAt = (event: PointerEvent<SVGSVGElement>): Point => {
  const box = event.currentTarget.getBoundingClientRect();
  return [
    event.clientX - box.left,
    event.clientY - box.top,
    event.pressure > 0 ? event.pressure : 0.5,
  ];
};

const xyOf = (event: PointerEvent<SVGSVGElement>): XY => {
  const point = pointAt(event);
  return [point[0], point[1]];
};

const pairBox = (
  a: XY,
  b: XY
): { h: number; w: number; x: number; y: number } => {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { h: Math.abs(b[1] - a[1]), w: Math.abs(b[0] - a[0]), x, y };
};

const snapPair = (a: XY, b: XY, kind: PairMark["kind"], shift: boolean): XY => {
  if (!shift) {
    return b;
  }
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (kind === "box" || kind === "circle") {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    return [a[0] + Math.sign(dx || 1) * s, a[1] + Math.sign(dy || 1) * s];
  }
  const len = Math.hypot(dx, dy);
  const snapped =
    Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [a[0] + Math.cos(snapped) * len, a[1] + Math.sin(snapped) * len];
};

const arrowHead = (a: XY, b: XY, size: number): string => {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const len = 10 + size * 2;
  const spread = 0.45;
  const left: XY = [
    b[0] - len * Math.cos(ang - spread),
    b[1] - len * Math.sin(ang - spread),
  ];
  const right: XY = [
    b[0] - len * Math.cos(ang + spread),
    b[1] - len * Math.sin(ang + spread),
  ];
  return `${b[0]},${b[1]} ${left[0]},${left[1]} ${right[0]},${right[1]}`;
};

const near = (p: XY, q: XY, r: number): boolean => {
  const dx = p[0] - q[0];
  const dy = p[1] - q[1];
  return dx * dx + dy * dy <= r * r;
};

const inBox = (p: XY, a: XY, b: XY, pad: number): boolean => {
  const x0 = Math.min(a[0], b[0]) - pad;
  const y0 = Math.min(a[1], b[1]) - pad;
  const x1 = Math.max(a[0], b[0]) + pad;
  const y1 = Math.max(a[1], b[1]) + pad;
  return p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
};

let measure: CanvasRenderingContext2D | null = null;

const textFont = (px: number): string =>
  `${px}px "Geist Variable", ui-sans-serif, sans-serif`;

const lineWidth = (text: string, px: number): number => {
  measure ??= document.createElement("canvas").getContext("2d");
  if (!measure) {
    return Math.max(px * 2, text.length * px * 0.62);
  }
  measure.font = textFont(px);
  return measure.measureText(text.length === 0 ? "W" : text).width;
};

const textSize = (text: string, size: number): { h: number; w: number } => {
  const px = fontPx(size);
  const lines = text.length === 0 ? [""] : text.split("\n");
  const w = Math.max(px * 2.5, ...lines.map((line) => lineWidth(line, px) + 1));
  return { h: lines.length * px * 1.25, w };
};

const textBox = (mark: TextMark): { a: XY; b: XY } => {
  const box = textSize(mark.text, mark.size);
  return {
    a: [mark.x, mark.y],
    b: [mark.x + box.w, mark.y + box.h],
  };
};

const hitsMark = (mark: Mark, pts: XY[], r: number): boolean => {
  if (mark.kind === "pen") {
    return mark.points.some((point) =>
      pts.some((q) => near([point[0], point[1]], q, r))
    );
  }
  if (mark.kind === "text") {
    const box = textBox(mark);
    return pts.some((p) => inBox(p, box.a, box.b, r));
  }
  return pts.some((p) => inBox(p, mark.a, mark.b, r));
};

const hitText = (marks: Mark[], p: XY): TextMark | undefined => {
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    const mark = marks[i];
    if (mark?.kind !== "text") {
      continue;
    }
    const box = textBox(mark);
    if (inBox(p, box.a, box.b, 6)) {
      return mark;
    }
  }
  return undefined;
};

const hitMark = (marks: Mark[], p: XY): Mark | undefined => {
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    const mark = marks[i];
    if (mark !== undefined && hitsMark(mark, [p], 12)) {
      return mark;
    }
  }
  return undefined;
};

const shiftMark = (mark: Mark, dx: number, dy: number): Mark => {
  if (mark.kind === "pen") {
    return {
      ...mark,
      points: mark.points.map((point) => [
        point[0] + dx,
        point[1] + dy,
        point[2],
      ]),
    };
  }
  if (mark.kind === "text") {
    return { ...mark, x: mark.x + dx, y: mark.y + dy };
  }
  return {
    ...mark,
    a: [mark.a[0] + dx, mark.a[1] + dy],
    b: [mark.b[0] + dx, mark.b[1] + dy],
  };
};

const markBounds = (
  mark: Mark
): { h: number; w: number; x: number; y: number } => {
  if (mark.kind === "pen") {
    const xs = mark.points.map((point) => point[0]);
    const ys = mark.points.map((point) => point[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { h: Math.max(...ys) - y, w: Math.max(...xs) - x, x, y };
  }
  if (mark.kind === "text") {
    const box = textBox(mark);
    return pairBox(box.a, box.b);
  }
  return pairBox(mark.a, mark.b);
};

const selectBounds = (mark: Mark): Bounds => {
  const raw = markBounds(mark);
  const pad = Math.max(8, mark.size * 0.5 + 6);
  let x = raw.x - pad;
  let y = raw.y - pad;
  let w = raw.w + pad * 2;
  let h = raw.h + pad * 2;
  if (w < 24) {
    x -= (24 - w) / 2;
    w = 24;
  }
  if (h < 24) {
    y -= (24 - h) / 2;
    h = 24;
  }
  return { h, w, x, y };
};

const clampZoom = (value: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

const zoomToward = (
  zoom: number,
  pan: XY,
  nextZoom: number,
  sx: number,
  sy: number
): { pan: XY; zoom: number } => {
  const z1 = clampZoom(nextZoom);
  const wx = (sx - pan[0]) / zoom;
  const wy = (sy - pan[1]) / zoom;
  return { pan: [sx - wx * z1, sy - wy * z1], zoom: z1 };
};

const BOX_HANDLES: Exclude<Handle, "a" | "b">[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

const handlePos = (box: Bounds, handle: Exclude<Handle, "a" | "b">): XY => {
  const midX = box.x + box.w / 2;
  const midY = box.y + box.h / 2;
  const x2 = box.x + box.w;
  const y2 = box.y + box.h;
  if (handle === "nw") {
    return [box.x, box.y];
  }
  if (handle === "n") {
    return [midX, box.y];
  }
  if (handle === "ne") {
    return [x2, box.y];
  }
  if (handle === "e") {
    return [x2, midY];
  }
  if (handle === "se") {
    return [x2, y2];
  }
  if (handle === "s") {
    return [midX, y2];
  }
  if (handle === "sw") {
    return [box.x, y2];
  }
  return [box.x, midY];
};

const handleCursor = (handle: Handle): string => {
  if (handle === "n" || handle === "s") {
    return "ns-resize";
  }
  if (handle === "e" || handle === "w") {
    return "ew-resize";
  }
  if (handle === "ne" || handle === "sw") {
    return "nesw-resize";
  }
  if (handle === "nw" || handle === "se") {
    return "nwse-resize";
  }
  return "pointer";
};

const hitEdit = (mark: Mark, p: XY, radius: number): Handle | undefined => {
  if (mark.kind === "arrow" || mark.kind === "line") {
    if (near(p, mark.a, radius)) {
      return "a";
    }
    if (near(p, mark.b, radius)) {
      return "b";
    }
    return undefined;
  }
  const box = selectBounds(mark);
  for (const handle of BOX_HANDLES) {
    if (near(p, handlePos(box, handle), radius)) {
      return handle;
    }
  }
  return undefined;
};

const resizeBounds = (
  start: Bounds,
  handle: Exclude<Handle, "a" | "b">,
  at: XY,
  shift: boolean
): Bounds => {
  const [ax, ay] = at;
  let x1 = start.x;
  let y1 = start.y;
  let x2 = start.x + start.w;
  let y2 = start.y + start.h;
  if (handle.includes("w")) {
    x1 = ax;
  }
  if (handle.includes("e")) {
    x2 = ax;
  }
  if (handle.includes("n")) {
    y1 = ay;
  }
  if (handle.includes("s")) {
    y2 = ay;
  }
  if (shift && handle.length === 2 && start.h > 0) {
    const aspect = start.w / start.h;
    const w = Math.abs(x2 - x1);
    const next = Math.max(w, Math.abs(y2 - y1) * aspect);
    const nextH = next / aspect;
    const sx = Math.sign(x2 - x1 || 1);
    const sy = Math.sign(y2 - y1 || 1);
    if (handle.includes("e")) {
      x2 = x1 + sx * next;
    }
    if (handle.includes("w")) {
      x1 = x2 - sx * next;
    }
    if (handle.includes("s")) {
      y2 = y1 + sy * nextH;
    }
    if (handle.includes("n")) {
      y1 = y2 - sy * nextH;
    }
  }
  if (Math.abs(x2 - x1) < 8) {
    x2 = x1 + Math.sign(x2 - x1 || 1) * 8;
  }
  if (Math.abs(y2 - y1) < 8) {
    y2 = y1 + Math.sign(y2 - y1 || 1) * 8;
  }
  return {
    h: Math.abs(y2 - y1),
    w: Math.abs(x2 - x1),
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
  };
};

const mapMark = (mark: Mark, from: Bounds, to: Bounds): Mark => {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  const mx = (x: number): number => to.x + (x - from.x) * sx;
  const my = (y: number): number => to.y + (y - from.y) * sy;
  if (mark.kind === "pen") {
    return {
      ...mark,
      points: mark.points.map((point) => [
        mx(point[0]),
        my(point[1]),
        point[2],
      ]),
    };
  }
  if (mark.kind === "text") {
    return {
      ...mark,
      size: mark.size * Math.max(0.35, (Math.abs(sx) + Math.abs(sy)) / 2),
      x: mx(mark.x),
      y: my(mark.y),
    };
  }
  return {
    ...mark,
    a: [mx(mark.a[0]), my(mark.a[1])],
    b: [mx(mark.b[0]), my(mark.b[1])],
  };
};

const editMark = (
  mark: Mark,
  drag: Extract<Drag, { kind: "resize" }>,
  at: XY,
  shift: boolean
): Mark => {
  if (drag.handle === "a" || drag.handle === "b") {
    if (mark.kind !== "arrow" && mark.kind !== "line") {
      return mark;
    }
    const other = drag.handle === "a" ? mark.b : mark.a;
    const next = snapPair(other, at, mark.kind, shift);
    if (drag.handle === "a") {
      return { ...mark, a: next };
    }
    return { ...mark, b: next };
  }
  return mapMark(
    mark,
    drag.box,
    resizeBounds(drag.box, drag.handle, at, shift)
  );
};

const worldXY = (
  event: PointerEvent<SVGSVGElement>,
  pan: XY,
  zoom: number
): XY => {
  const at = xyOf(event);
  return [(at[0] - pan[0]) / zoom, (at[1] - pan[1]) / zoom];
};

const worldAt = (
  event: PointerEvent<SVGSVGElement>,
  pan: XY,
  zoom: number
): Point => {
  const point = pointAt(event);
  return [(point[0] - pan[0]) / zoom, (point[1] - pan[1]) / zoom, point[2]];
};

let markSeq = 0;
const nextId = (): string => {
  markSeq += 1;
  return String(markSeq);
};

const paint = (ctx: CanvasRenderingContext2D, mark: Mark): void => {
  ctx.strokeStyle = mark.color;
  ctx.fillStyle = mark.color;
  ctx.lineWidth = mark.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (mark.kind === "pen") {
    const d = pathOf(mark.points, mark.size);
    if (!d) {
      return;
    }
    const path = new Path2D(d);
    // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- Canvas fill, not Array.fill
    ctx.fill(path);
    return;
  }
  if (mark.kind === "text") {
    const px = fontPx(mark.size);
    ctx.font = textFont(px);
    ctx.textBaseline = "top";
    for (const [i, line] of mark.text.split("\n").entries()) {
      ctx.fillText(line, mark.x, mark.y + i * px * 1.25);
    }
    return;
  }
  if (mark.kind === "box") {
    const box = pairBox(mark.a, mark.b);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    return;
  }
  if (mark.kind === "circle") {
    const box = pairBox(mark.a, mark.b);
    ctx.beginPath();
    ctx.ellipse(
      box.x + box.w / 2,
      box.y + box.h / 2,
      box.w / 2,
      box.h / 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(mark.a[0], mark.a[1]);
  ctx.lineTo(mark.b[0], mark.b[1]);
  ctx.stroke();
  if (mark.kind === "line") {
    return;
  }
  const [p0, p1, p2] = arrowHead(mark.a, mark.b, mark.size).split(" ");
  const tip = p0?.split(",").map(Number) ?? [];
  const left = p1?.split(",").map(Number) ?? [];
  const right = p2?.split(",").map(Number) ?? [];
  if (
    tip[0] === undefined ||
    tip[1] === undefined ||
    left[0] === undefined ||
    left[1] === undefined ||
    right[0] === undefined ||
    right[1] === undefined
  ) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(left[0], left[1]);
  ctx.lineTo(right[0], right[1]);
  ctx.closePath();
  // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- Canvas fill, not Array.fill
  ctx.fill();
};

const MarkSvg = ({ mark }: { mark: Mark }) => {
  if (mark.kind === "pen") {
    return <path d={pathOf(mark.points, mark.size)} fill={mark.color} />;
  }
  if (mark.kind === "text") {
    const px = fontPx(mark.size);
    return (
      <text
        dominantBaseline="hanging"
        fill={mark.color}
        fontFamily="inherit"
        fontSize={px}
        x={mark.x}
        y={mark.y}
      >
        {mark.text.split("\n").map((line, i) => (
          <tspan
            dy={i === 0 ? 0 : px * 1.25}
            key={`${mark.id}-${i}`}
            x={mark.x}
          >
            {line}
          </tspan>
        ))}
      </text>
    );
  }
  if (mark.kind === "box") {
    const box = pairBox(mark.a, mark.b);
    return (
      <rect
        fill="none"
        height={box.h}
        rx={2}
        stroke={mark.color}
        strokeWidth={mark.size}
        width={box.w}
        x={box.x}
        y={box.y}
      />
    );
  }
  if (mark.kind === "circle") {
    const box = pairBox(mark.a, mark.b);
    return (
      <ellipse
        cx={box.x + box.w / 2}
        cy={box.y + box.h / 2}
        fill="none"
        rx={box.w / 2}
        ry={box.h / 2}
        stroke={mark.color}
        strokeWidth={mark.size}
      />
    );
  }
  return (
    <g
      fill={mark.color}
      stroke={mark.color}
      strokeLinecap="round"
      strokeWidth={mark.size}
    >
      <line x1={mark.a[0]} x2={mark.b[0]} y1={mark.a[1]} y2={mark.b[1]} />
      {mark.kind === "arrow" ? (
        <polygon points={arrowHead(mark.a, mark.b, mark.size)} />
      ) : null}
    </g>
  );
};

const inkPad = (mark: Mark): number => {
  if (mark.kind === "pen") {
    return penWidth(mark.size) / 2 + 2;
  }
  if (mark.kind === "arrow") {
    return 12 + mark.size * 2;
  }
  if (mark.kind === "text") {
    return 4;
  }
  return mark.size / 2 + 2;
};

const contentBounds = (marks: Mark[]): Bounds | null => {
  if (marks.length === 0) {
    return null;
  }
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  for (const mark of marks) {
    const box = markBounds(mark);
    const pad = inkPad(mark);
    x1 = Math.min(x1, box.x - pad);
    y1 = Math.min(y1, box.y - pad);
    x2 = Math.max(x2, box.x + box.w + pad);
    y2 = Math.max(y2, box.y + box.h + pad);
  }
  if (!(Number.isFinite(x1) && Number.isFinite(y1))) {
    return null;
  }
  return { h: y2 - y1, w: x2 - x1, x: x1, y: y1 };
};

const toPng = async (
  marks: Mark[],
  fill: string
): Promise<Uint8Array | null> => {
  const frame = contentBounds(marks);
  if (!frame) {
    return null;
  }
  const margin = 24;
  const width = Math.max(8, frame.w + margin * 2);
  const height = Math.max(8, frame.h + margin * 2);
  const scale = Math.min(2, PNG_MAX / width, PNG_MAX / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.scale(scale, scale);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(-frame.x + margin, -frame.y + margin);
  for (const mark of marks) {
    paint(ctx, mark);
  }
  // oxlint-disable-next-line promise/avoid-new -- toBlob is callback-only
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) {
    return null;
  }
  return new Uint8Array(await blob.arrayBuffer());
};

const CHIP =
  "press flex size-6 shrink-0 items-center justify-center rounded-[8px] text-foreground outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3";

const CHIP_HOVER =
  "hover:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]";

const Chip = ({
  active = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) => (
  <button
    aria-pressed={active}
    className={cn(
      CHIP,
      active ? "bg-foreground text-background" : CHIP_HOVER,
      className
    )}
    type="button"
    {...props}
  />
);

const Tip = ({
  children,
  hint,
  label,
  side = "down",
}: {
  children: ReactNode;
  hint: string;
  label: string;
  side?: "down" | "up";
}) => (
  <span className="group relative inline-flex">
    {children}
    <span
      className={cn(
        "pointer-events-none absolute left-1/2 z-30 hidden -translate-x-1/2 items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] leading-none whitespace-nowrap group-hover:flex",
        "bg-foreground text-background",
        side === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
      )}
    >
      {label}
      <kbd className="font-medium opacity-55">{hint}</kbd>
    </span>
  </span>
);

export const DrawApp = () => {
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [marks, setMarks] = useState<Mark[]>([]);
  const [live, setLive] = useState<Mark | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [colorId, setColorId] = useState("ink");
  const [size, setSize] = useState<(typeof SIZES)[number]>(SIZES[1]);
  const [attach, setAttach] = useState(false);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [eraseAt, setEraseAt] = useState<XY | null>(null);
  const [eraseTrail, setEraseTrail] = useState<XY[]>([]);
  const [pan, setPan] = useState<XY>([0, 0]);
  const [zoom, setZoom] = useState(1);
  const [space, setSpace] = useState(false);
  const [hover, setHover] = useState<Handle | null>(null);
  const [flash, setFlash] = useState("");
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  const marksRef = useRef(marks);
  const toolRef = useRef(tool);
  const colorRef = useRef(colorId);
  const sizeRef = useRef(size);
  const liveRef = useRef<SVGPathElement>(null);
  const pointsRef = useRef<Point[]>([]);
  const startRef = useRef<XY>([0, 0]);
  const svgRef = useRef<SVGSVGElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const textDraftRef = useRef(textDraft);
  const ignoreBlurRef = useRef(false);
  const undoRef = useRef<Mark[][]>([]);
  const redoRef = useRef<Mark[][]>([]);
  const busyRef = useRef(false);
  const dragRef = useRef<Drag | null>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const spaceRef = useRef(space);

  marksRef.current = marks;
  toolRef.current = tool;
  colorRef.current = colorId;
  sizeRef.current = size;
  textDraftRef.current = textDraft;
  panRef.current = pan;
  zoomRef.current = zoom;
  spaceRef.current = space;

  const dark =
    settings.scheme === "dark" || (settings.scheme === "system" && systemDark);
  const color = swatchHex(colorId, dark);

  useEffect(() => {
    window.slip
      .load()
      .then((data) => {
        setSettings(data.settings);
      })
      .catch(() => undefined);
    const offMode = window.slip.onDrawMode((mode) => {
      setAttach(mode === "attach");
    });
    const offSettings = window.slip.onSettings(setSettings);
    return () => {
      offMode();
      offSettings();
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      setSystemDark(mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.dataset.accent = settings.accent;
    root.dataset.theme = settings.theme;
    root.dataset.font = settings.font;
    if (settings.font === "news") {
      void import("@fontsource-variable/newsreader/wght.css");
    }
  }, [dark, settings.accent, settings.font, settings.theme]);

  const textSession =
    textDraft === null
      ? ""
      : `${textDraft.id ?? "new"}:${textDraft.x}:${textDraft.y}`;

  useEffect(() => {
    if (textSession.length === 0) {
      return () => undefined;
    }
    ignoreBlurRef.current = true;
    const focus = (): void => {
      const node = textRef.current;
      if (!node) {
        return;
      }
      node.focus();
      node.selectionStart = node.value.length;
    };
    const arm = (): void => {
      ignoreBlurRef.current = false;
      focus();
    };
    const id = window.setTimeout(focus, 0);
    window.addEventListener("pointerup", arm, { once: true });
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerup", arm);
    };
  }, [textSession]);

  const remember = (prev: Mark[]): void => {
    undoRef.current.push(prev);
    if (undoRef.current.length > UNDO_MAX) {
      undoRef.current.shift();
    }
    redoRef.current = [];
  };

  const apply = (next: Mark[]): void => {
    remember(marksRef.current);
    setMarks(next);
  };

  const paintMarks = (patch: { color?: string; size?: number }): void => {
    if (selected === null || selected.length === 0) {
      return;
    }
    apply(
      marksRef.current.map((mark) =>
        mark.id === selected ? { ...mark, ...patch } : mark
      )
    );
  };

  const undo = (): void => {
    const prev = undoRef.current.pop();
    if (!prev) {
      return;
    }
    redoRef.current.push(marksRef.current);
    setMarks(prev);
  };

  const redo = (): void => {
    const next = redoRef.current.pop();
    if (!next) {
      return;
    }
    undoRef.current.push(marksRef.current);
    setMarks(next);
  };

  const commitText = (draft: TextDraft | null): void => {
    const text = draft?.text.replace(/\s+$/u, "") ?? "";
    setTextDraft(null);
    if (!draft || text.length === 0) {
      return;
    }
    const mark: TextMark = {
      color: draft.color,
      id: draft.id ?? nextId(),
      kind: "text",
      size: draft.size,
      text,
      x: draft.x,
      y: draft.y,
    };
    if (draft.id !== undefined && draft.id.length > 0) {
      apply(
        marksRef.current.map((item) => (item.id === draft.id ? mark : item))
      );
      return;
    }
    apply([...marksRef.current, mark]);
  };

  const exportPng = useCallback(
    (): Promise<Uint8Array | null> => toPng(marksRef.current, paper()),
    []
  );

  const zoomAtScreen = useCallback(
    (nextZoom: number, sx: number, sy: number): void => {
      const next = zoomToward(
        zoomRef.current,
        panRef.current,
        nextZoom,
        sx,
        sy
      );
      setZoom(next.zoom);
      setPan(next.pan);
    },
    []
  );

  const zoomFromCenter = useCallback(
    (factor: number): void => {
      const box = svgRef.current?.getBoundingClientRect();
      zoomAtScreen(
        zoomRef.current * factor,
        (box?.width ?? 0) / 2,
        (box?.height ?? 0) / 2
      );
    },
    [zoomAtScreen]
  );

  const resetZoom = useCallback((): void => {
    const box = svgRef.current?.getBoundingClientRect();
    zoomAtScreen(1, (box?.width ?? 0) / 2, (box?.height ?? 0) / 2);
  }, [zoomAtScreen]);

  const copy = useCallback(async (): Promise<void> => {
    if (busyRef.current) {
      return;
    }
    const bytes = await exportPng();
    if (!bytes) {
      return;
    }
    const ok = await window.slip.copyImage(bytes);
    if (ok) {
      setFlash("Copied");
      window.setTimeout(() => setFlash(""), 1600);
    }
  }, [exportPng]);

  const save = useCallback(async (): Promise<void> => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    const bytes = await exportPng();
    if (!bytes) {
      busyRef.current = false;
      return;
    }
    await window.slip.createDrawSlip({ bytes, name: "drawing.png" });
  }, [exportPng]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const typing =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
      if (event.key === "Escape") {
        event.preventDefault();
        if (textDraftRef.current) {
          setTextDraft(null);
          return;
        }
        if (selected !== null && selected.length > 0) {
          setSelected(null);
          return;
        }
        window.slip.closeDraw().catch(() => undefined);
        return;
      }
      if (typing) {
        return;
      }
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        if (!spaceRef.current) {
          setSpace(true);
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "d") {
        event.preventDefault();
        const mark = marksRef.current.find((item) => item.id === selected);
        if (!mark) {
          return;
        }
        const clone = shiftMark({ ...mark, id: nextId() }, 16, 16);
        apply([...marksRef.current, clone]);
        setSelected(clone.id);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
          return;
        }
        undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "c") {
        event.preventDefault();
        copy().catch(() => undefined);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        save().catch(() => undefined);
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === "=" ||
          event.key === "+" ||
          event.code === "Equal" ||
          event.code === "NumpadAdd")
      ) {
        event.preventDefault();
        zoomFromCenter(1.15);
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === "-" ||
          event.code === "Minus" ||
          event.code === "NumpadSubtract")
      ) {
        event.preventDefault();
        zoomFromCenter(1 / 1.15);
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === "0" ||
          event.code === "Digit0" ||
          event.code === "Numpad0")
      ) {
        event.preventDefault();
        resetZoom();
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        selected !== null &&
        selected.length > 0
      ) {
        event.preventDefault();
        apply(marksRef.current.filter((mark) => mark.id !== selected));
        setSelected(null);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (
        event.key === "=" ||
        event.key === "+" ||
        event.code === "NumpadAdd"
      ) {
        event.preventDefault();
        zoomFromCenter(1.15);
        return;
      }
      if (
        event.key === "-" ||
        event.key === "_" ||
        event.code === "NumpadSubtract"
      ) {
        event.preventDefault();
        zoomFromCenter(1 / 1.15);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetZoom();
        return;
      }
      if (event.key === "1" || event.key === "2" || event.key === "3") {
        const nextSize = SIZES[Math.trunc(Number(event.key)) - 1];
        if (nextSize !== undefined) {
          event.preventDefault();
          setSize(nextSize);
          const draft = textDraftRef.current;
          if (draft) {
            setTextDraft({ ...draft, size: nextSize });
          }
          if (selected !== null && selected.length > 0) {
            apply(
              marksRef.current.map((mark) =>
                mark.id === selected ? { ...mark, size: nextSize } : mark
              )
            );
          }
        }
        return;
      }
      if (
        selected !== null &&
        selected.length > 0 &&
        (event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "ArrowUp" ||
          event.key === "ArrowDown")
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (event.key === "ArrowLeft") {
          dx = -step;
        } else if (event.key === "ArrowRight") {
          dx = step;
        } else if (event.key === "ArrowUp") {
          dy = -step;
        } else {
          dy = step;
        }
        apply(
          marksRef.current.map((mark) =>
            mark.id === selected ? shiftMark(mark, dx, dy) : mark
          )
        );
        return;
      }
      const next = TOOL_BY_KEY[event.key.toLowerCase()];
      if (next) {
        event.preventDefault();
        commitText(textDraftRef.current);
        setTool(next);
        if (next !== "eraser") {
          setEraseAt(null);
          setEraseTrail([]);
        }
        if (next !== "hand" && next !== "select") {
          setSelected(null);
        }
      }
    };
    const onUp = (event: KeyboardEvent): void => {
      if (event.key === " " || event.code === "Space") {
        setSpace(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  }, [copy, resetZoom, save, selected, zoomFromCenter]);

  useEffect(() => {
    const node = svgRef.current;
    if (!node) {
      return () => undefined;
    }
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const box = node.getBoundingClientRect();
        zoomAtScreen(
          zoomRef.current * Math.exp(-event.deltaY * 0.01),
          event.clientX - box.left,
          event.clientY - box.top
        );
        return;
      }
      setPan((cur) => [cur[0] - event.deltaX, cur[1] - event.deltaY]);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [zoomAtScreen]);

  const empty = marks.length === 0;
  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  let cursor = "crosshair";
  if (space || tool === "hand") {
    cursor = dragRef.current?.kind === "pan" ? "grabbing" : "grab";
  } else if (tool === "text") {
    cursor = "text";
  } else if (tool === "eraser") {
    cursor = "none";
  } else if (hover) {
    cursor = handleCursor(hover);
  } else if (tool === "select") {
    cursor = selected === null ? "default" : "move";
  }
  const picked = marks.find((mark) => mark.id === selected);
  const pickBox = picked ? selectBounds(picked) : null;
  const inv = 1 / zoom;
  const draftPx = fontPx(textDraft?.size ?? size);
  const draftBox = textDraft ? textSize(textDraft.text, textDraft.size) : null;
  const eraseR = ERASE_R + size * 2;
  let erasePts: XY[] = eraseTrail;
  if (erasePts.length === 0 && eraseAt !== null) {
    erasePts = [eraseAt];
  }
  const doomed = new Set(
    erasePts.length === 0
      ? []
      : marks
          .filter((mark) => hitsMark(mark, erasePts, eraseR))
          .map((mark) => mark.id)
  );

  return (
    <div
      className={`bg-background text-foreground flex h-screen flex-col antialiased ${dark ? "dark" : ""}`}
      data-accent={settings.accent}
      data-font={settings.font}
      data-theme={settings.theme}
    >
      <header className="drag flex h-9.5 shrink-0 items-center gap-2 pr-2.5">
        <div className="flex min-w-28 shrink-0 items-center gap-1.5 pl-20">
          <img
            alt=""
            className={`pointer-events-none size-4 rounded-[4.5px] outline ${dark ? "outline-white/10" : "outline-black/10"}`}
            draggable={false}
            src={dark ? darkIcon : lightIcon}
          />
          <p className="truncate text-[13px] font-medium">
            {flash || "Slip Draw"}
          </p>
        </div>
        <div className="flex min-w-0 flex-1 justify-center">
          <div className="bg-card/92 no-drag flex items-center gap-0.5 rounded-xl px-1 py-0.5 shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
            {TOOLS.map((item) => (
              <Tip
                hint={item.key.toUpperCase()}
                key={item.id}
                label={item.label}
              >
                <Chip
                  active={tool === item.id}
                  aria-keyshortcuts={item.key}
                  aria-label={item.label}
                  onClick={() => {
                    commitText(textDraft);
                    setTool(item.id);
                    if (item.id !== "eraser") {
                      setEraseAt(null);
                      setEraseTrail([]);
                    }
                    if (item.id !== "hand" && item.id !== "select") {
                      setSelected(null);
                    }
                  }}
                >
                  <item.icon />
                </Chip>
              </Tip>
            ))}
            <span className="bg-border mx-0.5 h-4 w-px" />
            {PALETTE.map((item) => {
              const hex = dark ? item.dark : item.light;
              const on = colorId === item.id;
              return (
                <button
                  aria-label={item.id}
                  aria-pressed={on}
                  className={cn(CHIP, CHIP_HOVER)}
                  key={item.id}
                  onClick={() => {
                    setColorId(item.id);
                    if (textDraft) {
                      setTextDraft({ ...textDraft, color: hex });
                    }
                    paintMarks({ color: hex });
                  }}
                  title={item.id}
                  type="button"
                >
                  <span
                    className={cn(
                      "size-3.5 rounded-full",
                      on &&
                        "shadow-[0_0_0_2px_var(--background),0_0_0_3.5px_var(--foreground)]"
                    )}
                    style={{ background: hex }}
                  />
                </button>
              );
            })}
            <span className="bg-border mx-0.5 h-4 w-px" />
            {SIZES.map((item, i) => (
              <Tip hint={String(i + 1)} key={item} label={`Size ${i + 1}`}>
                <button
                  aria-keyshortcuts={String(i + 1)}
                  aria-label={`Size ${i + 1}`}
                  aria-pressed={size === item}
                  className={cn(
                    CHIP,
                    size === item ? "bg-foreground/10" : CHIP_HOVER
                  )}
                  onClick={() => {
                    setSize(item);
                    if (textDraft) {
                      setTextDraft({ ...textDraft, size: item });
                    }
                    paintMarks({ size: item });
                  }}
                  type="button"
                >
                  <span
                    className="bg-foreground rounded-full"
                    style={{ height: 4 + i * 3, width: 4 + i * 3 }}
                  />
                </button>
              </Tip>
            ))}
            <span className="bg-border mx-0.5 h-4 w-px" />
            <Tip hint="⌘Z" label="Undo">
              <Chip
                aria-keyshortcuts="Meta+Z"
                aria-label="Undo"
                disabled={!canUndo}
                onClick={undo}
              >
                <Undo2 />
              </Chip>
            </Tip>
            <Tip hint="⌘⇧Z" label="Redo">
              <Chip
                aria-keyshortcuts="Meta+Shift+Z"
                aria-label="Redo"
                disabled={!canRedo}
                onClick={redo}
              >
                <Redo2 />
              </Chip>
            </Tip>
          </div>
        </div>
        <div className="flex min-w-28 shrink-0 items-center justify-end">
          <div className="no-drag flex items-center gap-1">
            <Button
              aria-keyshortcuts="Meta+C"
              className="press"
              disabled={empty}
              onClick={() => {
                copy().catch(() => undefined);
              }}
              size="xs"
              variant="ghost"
            >
              Copy
              <kbd className="text-muted-foreground text-[10px] font-medium">
                ⌘C
              </kbd>
            </Button>
            <Button
              aria-keyshortcuts="Meta+Enter"
              className="press"
              disabled={empty}
              onClick={() => {
                save().catch(() => undefined);
              }}
              size="xs"
            >
              {attach ? "Add" : "Slip"}
              <kbd className="text-[10px] font-medium opacity-70">⌘↵</kbd>
            </Button>
          </div>
        </div>
      </header>
      <div
        className="no-drag relative min-h-0 flex-1"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklab, var(--foreground) 14%, transparent) 1px, transparent 1.2px)",
          backgroundPosition: `${pan[0]}px ${pan[1]}px`,
          backgroundSize: `${22 * zoom}px ${22 * zoom}px`,
        }}
      >
        <svg
          className="size-full touch-none"
          onPointerDown={(event) => {
            if (event.button !== 0 && event.button !== 1) {
              return;
            }
            const view = panRef.current;
            if (
              event.button === 1 ||
              spaceRef.current ||
              toolRef.current === "hand"
            ) {
              commitText(textDraftRef.current);
              dragRef.current = {
                at: xyOf(event),
                kind: "pan",
                pan: view,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              return;
            }
            const { current } = toolRef;
            const at = worldXY(event, view, zoomRef.current);
            if (current === "select") {
              commitText(textDraftRef.current);
              const pickedMark = marksRef.current.find(
                (mark) => mark.id === selected
              );
              const handle = pickedMark
                ? hitEdit(pickedMark, at, HANDLE / zoomRef.current)
                : undefined;
              if (handle !== undefined && pickedMark) {
                dragRef.current = {
                  at,
                  box: selectBounds(pickedMark),
                  handle,
                  id: pickedMark.id,
                  kind: "resize",
                  marks: marksRef.current,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                return;
              }
              const found = hitMark(marksRef.current, at);
              setSelected(found?.id ?? null);
              if (!found) {
                return;
              }
              if (event.detail === 2 && found.kind === "text") {
                ignoreBlurRef.current = true;
                setTextDraft({
                  color: found.color,
                  id: found.id,
                  size: found.size,
                  text: found.text,
                  x: found.x,
                  y: found.y,
                });
                return;
              }
              dragRef.current = {
                at,
                id: found.id,
                kind: "move",
                marks: marksRef.current,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              return;
            }
            if (current === "text") {
              commitText(textDraftRef.current);
              const found = hitText(marksRef.current, at);
              ignoreBlurRef.current = true;
              setTextDraft({
                color: found?.color ?? swatchHex(colorRef.current, dark),
                id: found?.id,
                size: found?.size ?? sizeRef.current,
                text: found?.text ?? "",
                x: found?.x ?? at[0],
                y: found?.y ?? at[1],
              });
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            const hex = swatchHex(colorRef.current, dark);
            const nextSize = sizeRef.current;
            if (current === "pen") {
              pointsRef.current = [worldAt(event, view, zoomRef.current)];
              if (liveRef.current) {
                liveRef.current.setAttribute(
                  "d",
                  pathOf(pointsRef.current, nextSize)
                );
                liveRef.current.setAttribute("fill", hex);
              }
              return;
            }
            if (current === "eraser") {
              pointsRef.current = [worldAt(event, view, zoomRef.current)];
              setEraseAt(at);
              setEraseTrail([at]);
              return;
            }
            startRef.current = at;
            if (
              current === "arrow" ||
              current === "box" ||
              current === "circle" ||
              current === "line"
            ) {
              setLive({
                a: at,
                b: at,
                color: hex,
                id: "live",
                kind: current,
                size: nextSize,
              });
            }
          }}
          onPointerLeave={() => {
            setHover(null);
            if (
              toolRef.current === "eraser" &&
              pointsRef.current.length === 0
            ) {
              setEraseAt(null);
            }
          }}
          onPointerMove={(event) => {
            const view = panRef.current;
            const at = worldXY(event, view, zoomRef.current);
            const { current } = toolRef;
            if (current === "eraser") {
              setEraseAt(at);
            }
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
              const pickedMark = marksRef.current.find(
                (mark) => mark.id === selected
              );
              setHover(
                current === "select" && pickedMark
                  ? (hitEdit(pickedMark, at, HANDLE / zoomRef.current) ?? null)
                  : null
              );
              return;
            }
            const drag = dragRef.current;
            if (drag?.kind === "pan") {
              const screen = xyOf(event);
              setPan([
                drag.pan[0] + screen[0] - drag.at[0],
                drag.pan[1] + screen[1] - drag.at[1],
              ]);
              return;
            }
            const hex = swatchHex(colorRef.current, dark);
            const nextSize = sizeRef.current;
            if (drag?.kind === "move") {
              setMarks(
                drag.marks.map((mark) =>
                  mark.id === drag.id
                    ? shiftMark(mark, at[0] - drag.at[0], at[1] - drag.at[1])
                    : mark
                )
              );
              return;
            }
            if (drag?.kind === "resize") {
              setMarks(
                drag.marks.map((mark) =>
                  mark.id === drag.id
                    ? editMark(mark, drag, at, event.shiftKey)
                    : mark
                )
              );
              return;
            }
            if (current === "pen") {
              pointsRef.current = [
                ...pointsRef.current,
                worldAt(event, view, zoomRef.current),
              ];
              if (liveRef.current) {
                liveRef.current.setAttribute(
                  "d",
                  pathOf(pointsRef.current, nextSize)
                );
              }
              return;
            }
            if (current === "eraser") {
              const next = [
                ...pointsRef.current,
                worldAt(event, view, zoomRef.current),
              ];
              pointsRef.current = next;
              setEraseTrail(next.map((point): XY => [point[0], point[1]]));
              return;
            }
            if (
              current === "arrow" ||
              current === "box" ||
              current === "circle" ||
              current === "line"
            ) {
              setLive({
                a: startRef.current,
                b: snapPair(startRef.current, at, current, event.shiftKey),
                color: hex,
                id: "live",
                kind: current,
                size: nextSize,
              });
            }
          }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
              return;
            }
            event.currentTarget.releasePointerCapture(event.pointerId);
            const view = panRef.current;
            const { current } = toolRef;
            const points = pointsRef.current;
            pointsRef.current = [];
            if (liveRef.current) {
              liveRef.current.setAttribute("d", "");
            }
            setLive(null);
            const hex = swatchHex(colorRef.current, dark);
            const nextSize = sizeRef.current;
            const drag = dragRef.current;
            dragRef.current = null;
            if (drag?.kind === "pan") {
              return;
            }
            if (drag?.kind === "move" || drag?.kind === "resize") {
              const at = worldXY(event, view, zoomRef.current);
              if (Math.hypot(at[0] - drag.at[0], at[1] - drag.at[1]) < 2) {
                setMarks(drag.marks);
                return;
              }
              remember(drag.marks);
              setMarks([...marksRef.current]);
              return;
            }
            if (current === "pen") {
              if (points.length === 0) {
                return;
              }
              apply([
                ...marksRef.current,
                {
                  color: hex,
                  id: nextId(),
                  kind: "pen",
                  points,
                  size: nextSize,
                },
              ]);
              return;
            }
            if (current === "eraser") {
              const pts = points.map((p): XY => [p[0], p[1]]);
              const next = marksRef.current.filter(
                (mark) => !hitsMark(mark, pts, ERASE_R + nextSize * 2)
              );
              if (next.length !== marksRef.current.length) {
                apply(next);
              }
              setEraseTrail([]);
              return;
            }
            if (
              current !== "arrow" &&
              current !== "box" &&
              current !== "circle" &&
              current !== "line"
            ) {
              return;
            }
            const a = startRef.current;
            const b = snapPair(
              a,
              worldXY(event, view, zoomRef.current),
              current,
              event.shiftKey
            );
            if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 4) {
              return;
            }
            apply([
              ...marksRef.current,
              {
                a,
                b,
                color: hex,
                id: nextId(),
                kind: current,
                size: nextSize,
              },
            ]);
          }}
          ref={svgRef}
          style={{ cursor }}
        >
          <g transform={`translate(${pan[0]} ${pan[1]}) scale(${zoom})`}>
            {marks
              .filter((mark) => mark.id !== textDraft?.id)
              .map((mark) => (
                <g key={mark.id} opacity={doomed.has(mark.id) ? 0.28 : 1}>
                  <MarkSvg mark={mark} />
                </g>
              ))}
            {live ? <MarkSvg mark={live} /> : null}
            {pickBox && picked ? (
              <g>
                <rect
                  fill={SELECT}
                  fillOpacity={0.05}
                  height={pickBox.h}
                  rx={3 * inv}
                  stroke={SELECT}
                  strokeWidth={1.5 * inv}
                  width={pickBox.w}
                  x={pickBox.x}
                  y={pickBox.y}
                />
                {picked.kind === "arrow" || picked.kind === "line" ? (
                  <>
                    <g
                      transform={`translate(${picked.a[0]} ${picked.a[1]}) scale(${inv})`}
                    >
                      <circle
                        fill="var(--background)"
                        r={5}
                        stroke={SELECT}
                        strokeWidth={1.5}
                      />
                    </g>
                    <g
                      transform={`translate(${picked.b[0]} ${picked.b[1]}) scale(${inv})`}
                    >
                      <circle
                        fill="var(--background)"
                        r={5}
                        stroke={SELECT}
                        strokeWidth={1.5}
                      />
                    </g>
                  </>
                ) : (
                  BOX_HANDLES.map((handle) => {
                    const [hx, hy] = handlePos(pickBox, handle);
                    return (
                      <rect
                        fill="var(--background)"
                        height={8}
                        key={handle}
                        rx={1.5}
                        stroke={SELECT}
                        strokeWidth={1.5}
                        transform={`translate(${hx} ${hy}) scale(${inv})`}
                        width={8}
                        x={-4}
                        y={-4}
                      />
                    );
                  })
                )}
              </g>
            ) : null}
            <path fill={color} ref={liveRef} />
            {tool === "eraser" && eraseTrail.length > 1 ? (
              <polyline
                fill="none"
                points={eraseTrail
                  .map((point) => `${point[0]},${point[1]}`)
                  .join(" ")}
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={0.18}
                strokeWidth={eraseR * 2}
              />
            ) : null}
            {eraseAt && tool === "eraser" ? (
              <circle
                cx={eraseAt[0]}
                cy={eraseAt[1]}
                fill="currentColor"
                fillOpacity={0.14}
                r={eraseR}
                stroke="currentColor"
                strokeOpacity={0.55}
                strokeWidth={1.25}
              />
            ) : null}
          </g>
        </svg>
        {textDraft && draftBox ? (
          <textarea
            className="absolute z-10 resize-none overflow-hidden rounded-[3px] bg-transparent p-0 outline-none placeholder:opacity-35"
            onBlur={() => {
              if (ignoreBlurRef.current) {
                textRef.current?.focus();
                return;
              }
              commitText(textDraftRef.current);
            }}
            onChange={(event) => {
              setTextDraft((cur) =>
                cur ? { ...cur, text: event.target.value } : cur
              );
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                setTextDraft(null);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commitText(textDraftRef.current);
              }
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            placeholder="Type"
            ref={textRef}
            rows={1}
            spellCheck={false}
            style={{
              boxShadow: `0 0 0 3px color-mix(in oklab, ${textDraft.color} 16%, transparent)`,
              caretColor: textDraft.color,
              color: textDraft.color,
              fontFamily: "inherit",
              fontSize: draftPx * zoom,
              height: (draftBox.h + 2) * zoom,
              left: textDraft.x * zoom + pan[0],
              lineHeight: 1.25,
              top: textDraft.y * zoom + pan[1],
              width: (draftBox.w + 4) * zoom,
            }}
            value={textDraft.text}
          />
        ) : null}
        <div className="bg-card/92 no-drag absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-lg px-0.5 py-0.5 shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
          <Tip hint="−" label="Zoom out" side="up">
            <Chip
              aria-keyshortcuts="-"
              aria-label="Zoom out"
              disabled={zoom <= ZOOM_MIN}
              onClick={() => zoomFromCenter(1 / 1.15)}
            >
              <ZoomOut />
            </Chip>
          </Tip>
          <Tip hint="0" label="Reset zoom" side="up">
            <Chip
              aria-keyshortcuts="0"
              aria-label="Reset zoom"
              className="min-w-9 px-1 text-[11px] tabular-nums"
              onClick={resetZoom}
            >
              {`${Math.round(zoom * 100)}%`}
            </Chip>
          </Tip>
          <Tip hint="+" label="Zoom in" side="up">
            <Chip
              aria-keyshortcuts="+"
              aria-label="Zoom in"
              disabled={zoom >= ZOOM_MAX}
              onClick={() => zoomFromCenter(1.15)}
            >
              <ZoomIn />
            </Chip>
          </Tip>
        </div>
        <p className="text-muted-foreground pointer-events-none absolute right-3 bottom-3 text-[10px] tracking-wide">
          {selected === null || selected.length === 0
            ? "Space pan"
            : "⌘D duplicate  ·  ⌫ delete"}
        </p>
      </div>
    </div>
  );
};
