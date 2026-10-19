import { THEMES } from "@quickdrawjs/core";
import type { ColorId, Editor, GeoId, SizeId, ToolId } from "@quickdrawjs/core";
import { Quickdraw } from "@quickdrawjs/react";
import type { QuickdrawRef } from "@quickdrawjs/react";
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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";

import "@quickdrawjs/core/quickdraw.css";

import darkIcon from "@/assets/dock-dark.png";
import lightIcon from "@/assets/dock-light.png";
import { Button } from "@/components/ui/button";
import { installPlateLayer } from "@/lib/draw-plate";
import {
  filesFromClipboard,
  filesFromList,
  hasImageFiles,
} from "@/lib/drop-images";
import { cn } from "@/lib/utils";

import {
  blankExportScale,
  cameraForFrame,
  EXPORT_MARGIN,
  fitContain,
  flattenBitmap,
  paintFlatten,
} from "../../shared/annotate";
import type { DrawTarget, Rect } from "../../shared/annotate";
import { attachmentType } from "../../shared/images";
import { defaultSettings } from "../../shared/types";
import type { Settings } from "../../shared/types";

type SlipTool =
  | "arrow"
  | "box"
  | "circle"
  | "eraser"
  | "hand"
  | "line"
  | "pen"
  | "select"
  | "text";

interface Plate {
  frame: Rect;
  img: HTMLImageElement;
  slipId: string;
  url: string;
}

interface Offer {
  label: string;
  url: string;
}

const COLORS: { id: ColorId; label: string }[] = [
  { id: "black", label: "ink" },
  { id: "red", label: "red" },
  { id: "orange", label: "amber" },
  { id: "green", label: "green" },
  { id: "blue", label: "blue" },
  { id: "violet", label: "violet" },
];

const SIZES = ["s", "m", "l"] as const satisfies readonly SizeId[];

const ZOOM_MAX = 4;
const ZOOM_MIN = 0.25;
const ZOOM_STEP = 1.15;

const TOOLS: {
  hint: string;
  icon: typeof Pencil;
  id: SlipTool;
  label: string;
}[] = [
  { hint: "V", icon: MousePointer2, id: "select", label: "Select" },
  { hint: "H", icon: Hand, id: "hand", label: "Hand" },
  { hint: "P", icon: Pencil, id: "pen", label: "Pen" },
  { hint: "E", icon: Eraser, id: "eraser", label: "Eraser" },
  { hint: "L", icon: Minus, id: "line", label: "Line" },
  { hint: "A", icon: ArrowUpRight, id: "arrow", label: "Arrow" },
  { hint: "R", icon: Square, id: "box", label: "Box" },
  { hint: "O", icon: Circle, id: "circle", label: "Circle" },
  { hint: "T", icon: Type, id: "text", label: "Text" },
];

const CHIP =
  "press flex size-6 shrink-0 items-center justify-center rounded-[8px] text-foreground outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3";

const CHIP_HOVER =
  "hover:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]";

const emptyFrame = (): Rect => ({ h: 0, w: 0, x: 0, y: 0 });

const inGesture = (editor: Editor): boolean => {
  const session: unknown = Reflect.get(editor, "session");
  return session !== null && session !== undefined;
};

const keepFocus = (event: { preventDefault: () => void }): void => {
  event.preventDefault();
};

const canvasBytes = async (
  canvas: HTMLCanvasElement
): Promise<Uint8Array | null> => {
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

const loadImage = (url: string): Promise<HTMLImageElement | null> =>
  // oxlint-disable-next-line promise/avoid-new -- Image has no promise API
  new Promise((resolve) => {
    const img = new Image();
    img.addEventListener("load", () => {
      resolve(img);
    });
    img.addEventListener("error", () => {
      resolve(null);
    });
    img.src = url;
  });

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
    onMouseDown={keepFocus}
    type="button"
    {...props}
  />
);

const TIP_GAP = 6;

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
}) => {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const host = anchor.current;
    const node = tip.current;
    if (!open || host === null || node === null) {
      return;
    }
    const box = host.getBoundingClientRect();
    const size = node.getBoundingClientRect();
    const pad = 4;
    const left = Math.min(
      Math.max(box.left + (box.width - size.width) / 2, pad),
      window.innerWidth - size.width - pad
    );
    const below = box.bottom + TIP_GAP;
    const above = box.top - size.height - TIP_GAP;
    const top = side === "up" ? above : below;
    node.style.left = `${left}px`;
    node.style.top = `${Math.min(
      Math.max(top, pad),
      window.innerHeight - size.height - pad
    )}px`;
  }, [open, side]);

  return (
    <span
      className="inline-flex"
      onMouseEnter={() => {
        setOpen(true);
      }}
      onMouseLeave={() => {
        setOpen(false);
      }}
      ref={anchor}
    >
      {children}
      {open
        ? createPortal(
            <span
              className="bg-foreground text-background pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] leading-none whitespace-nowrap"
              ref={tip}
            >
              {label}
              <kbd className="font-medium opacity-55">{hint}</kbd>
            </span>,
            document.body
          )
        : null}
    </span>
  );
};

const toolActive = (tool: ToolId, geo: GeoId, id: SlipTool): boolean => {
  if (id === "pen") {
    return tool === "draw";
  }
  if (id === "box") {
    return tool === "geo" && geo === "rectangle";
  }
  if (id === "circle") {
    return tool === "geo" && geo === "ellipse";
  }
  return tool === id;
};

export const DrawApp = () => {
  const boardRef = useRef<QuickdrawRef>(null);
  const editorRef = useRef<Editor | null>(null);
  const plateRef = useRef<Plate | null>(null);
  const offerRef = useRef<Offer | null>(null);
  const userViewRef = useRef(false);
  const quietRef = useRef(false);
  const busyRef = useRef(false);
  const offeredRef = useRef(false);
  const targetKeyRef = useRef("");
  const flashTimer = useRef(0);
  const resizeRef = useRef<ResizeObserver | null>(null);

  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [tool, setTool] = useState<ToolId>("draw");
  const [geo, setGeo] = useState<GeoId>("rectangle");
  const [color, setColor] = useState<ColorId>("black");
  const [size, setSize] = useState<SizeId>("m");
  const [zoom, setZoom] = useState(1);
  const [ink, setInk] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [attach, setAttach] = useState(false);
  const [plate, setPlate] = useState<{ slipId: string; url: string } | null>(
    null
  );
  const [offer, setOffer] = useState<Offer | null>(null);
  const [flash, setFlash] = useState("");
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  offerRef.current = offer;

  const dark =
    settings.scheme === "dark" || (settings.scheme === "system" && systemDark);
  const palette = dark ? THEMES.dark : THEMES.light;

  const showFlash = (text: string): void => {
    setFlash(text);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      setFlash("");
    }, 1600);
  };

  const syncDoc = (editor: Editor): void => {
    setInk(editor.store.shapes().length > 0);
    setCanUndo(editor.store.canUndo);
    setCanRedo(editor.store.canRedo);
    setZoom(editor.camera.z);
  };

  const fitPlate = (): void => {
    const editor = editorRef.current;
    const { current } = plateRef;
    if (!editor || !current) {
      return;
    }
    const view = editor.viewSize();
    if (view.w <= 1 || view.h <= 1) {
      return;
    }
    if (current.frame.w <= 0 || current.frame.h <= 0) {
      current.frame = fitContain(view, {
        h: current.img.naturalHeight,
        w: current.img.naturalWidth,
      });
    }
    if (userViewRef.current) {
      editor.requestRender();
      return;
    }
    quietRef.current = true;
    editor.setCamera(cameraForFrame(view, current.frame));
    quietRef.current = false;
    setZoom(editor.camera.z);
  };

  const placePlate = (
    img: HTMLImageElement,
    url: string,
    slipId: string
  ): void => {
    const previous = plateRef.current;
    if (previous && previous.url.startsWith("blob:") && previous.url !== url) {
      URL.revokeObjectURL(previous.url);
    }
    const next: Plate = { frame: emptyFrame(), img, slipId, url };
    plateRef.current = next;
    setPlate({ slipId, url });
    userViewRef.current = false;
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.store.loadSnapshot({ document: { store: {} } }, "remote");
    editor.setSelection([]);
    fitPlate();
  };

  const stageUrl = (url: string, label: string): void => {
    setOffer((prev) => {
      if (prev !== null && prev.url.startsWith("blob:") && prev.url !== url) {
        URL.revokeObjectURL(prev.url);
      }
      return { label, url };
    });
  };

  const dismissOffer = (): void => {
    setOffer((prev) => {
      if (prev !== null && prev.url.startsWith("blob:")) {
        URL.revokeObjectURL(prev.url);
      }
      return null;
    });
  };

  const acceptOffer = (): void => {
    const url = offerRef.current?.url;
    if (url === undefined) {
      return;
    }
    setOffer(null);
    loadImage(url)
      .then((img) => {
        if (!img) {
          if (url.startsWith("blob:")) {
            URL.revokeObjectURL(url);
          }
          showFlash("Couldn't read image");
          return;
        }
        placePlate(img, url, plateRef.current?.slipId ?? "");
      })
      .catch(() => undefined);
  };

  const applyTool = (id: SlipTool): void => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    if (id === "box") {
      editor.setGeoKind("rectangle");
      editor.setTool("geo");
      return;
    }
    if (id === "circle") {
      editor.setGeoKind("ellipse");
      editor.setTool("geo");
      return;
    }
    editor.setTool(id === "pen" ? "draw" : id);
  };

  const applySize = (next: SizeId): void => {
    editorRef.current?.setStyle("size", next);
  };

  const zoomFromCenter = (factor: number): void => {
    const editor = editorRef.current;
    if (!editor || !(editor.camera.z > 0)) {
      return;
    }
    const view = editor.viewSize();
    const next = Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN, editor.camera.z * factor)
    );
    userViewRef.current = true;
    editor.zoomAt(view.w / 2, view.h / 2, next / editor.camera.z, {
      animate: 0,
    });
  };

  const resetZoom = (): void => {
    const editor = editorRef.current;
    if (!editor || !(editor.camera.z > 0)) {
      return;
    }
    const { current } = plateRef;
    const view = editor.viewSize();
    if (current && current.frame.w > 0) {
      userViewRef.current = false;
      quietRef.current = true;
      editor.setCamera(cameraForFrame(view, current.frame));
      quietRef.current = false;
      setZoom(editor.camera.z);
      return;
    }
    userViewRef.current = true;
    editor.zoomAt(view.w / 2, view.h / 2, 1 / editor.camera.z, { animate: 0 });
  };

  const exportPng = async (): Promise<Uint8Array | null> => {
    const editor = editorRef.current;
    if (!editor || editor.store.shapes().length === 0) {
      return null;
    }
    const bounds = editor.contentBounds();
    if (!bounds) {
      return null;
    }
    const { current } = plateRef;
    if (current && current.frame.w > 0 && current.frame.h > 0) {
      const dpr = window.devicePixelRatio || 1;
      const native = {
        h: current.img.naturalHeight,
        w: current.img.naturalWidth,
      };
      const bitmap = flattenBitmap(native, dpr);
      if (bitmap.w === 0 || bitmap.h === 0) {
        return null;
      }
      const blob = await editor.exportImage({
        background: false,
        margin: 0,
        scale: bitmap.w / current.frame.w,
      });
      if (!blob) {
        return null;
      }
      const inkUrl = URL.createObjectURL(blob);
      const inkImage = await loadImage(inkUrl);
      URL.revokeObjectURL(inkUrl);
      if (!inkImage) {
        return null;
      }
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.w;
      canvas.height = bitmap.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return null;
      }
      paintFlatten(
        (slot, x, y, w, h) => {
          ctx.drawImage(slot === "plate" ? current.img : inkImage, x, y, w, h);
        },
        current.frame,
        bounds,
        native,
        dpr
      );
      return await canvasBytes(canvas);
    }
    const blob = await editor.exportImage({
      background: true,
      margin: EXPORT_MARGIN,
      scale: blankExportScale(bounds),
    });
    if (!blob) {
      return null;
    }
    return new Uint8Array(await blob.arrayBuffer());
  };

  const copy = async (): Promise<void> => {
    if (busyRef.current) {
      return;
    }
    const bytes = await exportPng();
    if (!bytes) {
      return;
    }
    const ok = await window.slip.copyImage(bytes);
    if (ok) {
      showFlash("Copied");
    }
  };

  const save = async (): Promise<void> => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      const bytes = await exportPng();
      if (!bytes) {
        return;
      }
      const id = plateRef.current?.slipId ?? "";
      if (id.length > 0) {
        const saved = await window.slip.addImages(id, [
          { bytes, name: "annotated.png" },
        ]);
        if (saved) {
          await window.slip.closeDraw();
        }
        return;
      }
      await window.slip.createDrawSlip({
        bytes,
        name: plateRef.current ? "annotated.png" : "drawing.png",
      });
    } finally {
      busyRef.current = false;
    }
  };

  const apiRef = useRef({
    applySize,
    applyTool,
    copy,
    dismissOffer,
    resetZoom,
    save,
    zoomFromCenter,
  });
  apiRef.current = {
    applySize,
    applyTool,
    copy,
    dismissOffer,
    resetZoom,
    save,
    zoomFromCenter,
  };

  useEffect(() => {
    let gone = false;
    const openTarget = (target: DrawTarget): void => {
      const key = `${target.slipId}:${target.imagePath}`;
      if (key === targetKeyRef.current) {
        return;
      }
      targetKeyRef.current = key;
      const run = async (): Promise<void> => {
        const bytes = await window.slip.readAttachment(target.imagePath);
        if (gone || targetKeyRef.current !== key) {
          return;
        }
        if (bytes === null) {
          showFlash("Couldn't read image");
          return;
        }
        const copyBytes = Uint8Array.from(bytes);
        const url = URL.createObjectURL(
          new Blob([copyBytes], { type: attachmentType(target.imagePath) })
        );
        const img = await loadImage(url);
        if (gone || targetKeyRef.current !== key) {
          URL.revokeObjectURL(url);
          return;
        }
        if (img === null) {
          URL.revokeObjectURL(url);
          showFlash("Couldn't read image");
          return;
        }
        placePlate(img, url, target.slipId);
      };
      run().catch(() => undefined);
    };
    const boot = async (): Promise<void> => {
      const data = await window.slip.load();
      if (gone) {
        return;
      }
      setSettings(data.settings);
      const session = await window.slip.drawSession();
      if (gone) {
        return;
      }
      setAttach(session.mode === "attach");
      if (session.target) {
        openTarget(session.target);
        return;
      }
      if (offeredRef.current) {
        return;
      }
      offeredRef.current = true;
      const image = await window.slip.clipboardImage();
      if (gone || image === null || targetKeyRef.current.length > 0) {
        return;
      }
      const copyBytes = Uint8Array.from(image.bytes);
      stageUrl(
        URL.createObjectURL(new Blob([copyBytes], { type: "image/png" })),
        "Clipboard image"
      );
    };
    boot().catch(() => undefined);
    const offMode = window.slip.onDrawMode((mode) => {
      setAttach(mode === "attach");
    });
    const offTarget = window.slip.onDrawTarget((target) => {
      if (!target) {
        return;
      }
      apiRef.current.dismissOffer();
      openTarget(target);
    });
    const offSettings = window.slip.onSettings(setSettings);
    return () => {
      gone = true;
      targetKeyRef.current = "";
      window.clearTimeout(flashTimer.current);
      resizeRef.current?.disconnect();
      const { current } = plateRef;
      if (current?.url.startsWith("blob:") === true) {
        URL.revokeObjectURL(current.url);
      }
      offMode();
      offTarget();
      offSettings();
    };
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLInputElement
      ) {
        return;
      }
      const [file] = filesFromClipboard(event.clipboardData);
      if (file !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        stageUrl(URL.createObjectURL(file), file.name || "Pasted image");
        return;
      }
      const text = event.clipboardData?.getData("text") ?? "";
      if (text.length > 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      window.slip
        .clipboardImage()
        .then((image) => {
          if (image === null) {
            return;
          }
          const copyBytes = Uint8Array.from(image.bytes);
          stageUrl(
            URL.createObjectURL(new Blob([copyBytes], { type: "image/png" })),
            "Pasted image"
          );
        })
        .catch(() => undefined);
    };
    const onDrop = (event: DragEvent): void => {
      const [file] = filesFromList(event.dataTransfer?.files ?? []);
      if (file === undefined) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      stageUrl(URL.createObjectURL(file), file.name || "Dropped image");
    };
    const onOver = (event: DragEvent): void => {
      if (!hasImageFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("paste", onPaste, true);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("dragover", onOver, true);
    return () => {
      window.removeEventListener("paste", onPaste, true);
      window.removeEventListener("drop", onDrop, true);
      window.removeEventListener("dragover", onOver, true);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const typing =
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLInputElement;
      const meta = event.metaKey || event.ctrlKey;
      if (event.key === "Escape") {
        if (typing) {
          return;
        }
        if (offerRef.current) {
          event.preventDefault();
          event.stopPropagation();
          apiRef.current.dismissOffer();
          return;
        }
        const editor = editorRef.current;
        if (editor && inGesture(editor)) {
          return;
        }
        if (editor && editor.selection.size > 0) {
          event.preventDefault();
          event.stopPropagation();
          editor.setSelection([]);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        window.slip.closeDraw().catch(() => undefined);
        return;
      }
      if (typing) {
        return;
      }
      if (meta && event.key.toLowerCase() === "c") {
        event.preventDefault();
        event.stopPropagation();
        apiRef.current.copy().catch(() => undefined);
        return;
      }
      if (meta && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        apiRef.current.save().catch(() => undefined);
        return;
      }
      if (meta && event.key.toLowerCase() === "v") {
        event.stopPropagation();
        return;
      }
      if (meta || event.altKey) {
        if (
          meta &&
          (event.key === "=" ||
            event.key === "+" ||
            event.key === "-" ||
            event.key === "0")
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "0") {
            apiRef.current.resetZoom();
            return;
          }
          apiRef.current.zoomFromCenter(
            event.key === "-" ? 1 / ZOOM_STEP : ZOOM_STEP
          );
        }
        return;
      }
      if (event.key === "1" || event.key === "2" || event.key === "3") {
        const next = SIZES[Number(event.key) - 1];
        if (next !== undefined) {
          event.preventDefault();
          event.stopPropagation();
          apiRef.current.applySize(next);
        }
        return;
      }
      if (event.key === "=" || event.key === "+" || event.key === "-") {
        event.preventDefault();
        event.stopPropagation();
        apiRef.current.zoomFromCenter(
          event.key === "-" ? 1 / ZOOM_STEP : ZOOM_STEP
        );
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        event.stopPropagation();
        apiRef.current.resetZoom();
        return;
      }
      const byKey: Record<string, SlipTool | undefined> = {
        a: "arrow",
        e: "eraser",
        h: "hand",
        l: "line",
        o: "circle",
        p: "pen",
        r: "box",
        t: "text",
        v: "select",
      };
      const next = byKey[event.key.toLowerCase()];
      if (next) {
        event.preventDefault();
        apiRef.current.applyTool(next);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      setSystemDark(mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
    };
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

  const mount = (editor: Editor): void => {
    editorRef.current = editor;
    installPlateLayer(editor, () => {
      const { current } = plateRef;
      if (!current || current.frame.w <= 0 || current.frame.h <= 0) {
        return null;
      }
      return { frame: current.frame, img: current.img };
    });
    const sync = (): void => {
      syncDoc(editor);
    };
    editor.on("change", sync);
    editor.on("history", sync);
    editor.on("camera", () => {
      setZoom(editor.camera.z);
      if (!quietRef.current) {
        userViewRef.current = true;
      }
    });
    editor.on("tool", () => {
      setTool(editor.tool);
      setGeo(editor.geoKind);
    });
    editor.on("styles", () => {
      setColor(editor.styles.color);
      setSize(editor.styles.size);
    });
    resizeRef.current?.disconnect();
    const obs = new ResizeObserver(() => {
      fitPlate();
    });
    resizeRef.current = obs;
    obs.observe(editor.container);
    if (plateRef.current) {
      editor.store.loadSnapshot({ document: { store: {} } }, "remote");
      userViewRef.current = false;
      fitPlate();
    }
    editor.container.focus();
    sync();
  };

  const slipId = plate?.slipId ?? "";

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
            {flash || (plate === null ? "Slip Draw" : "Annotate")}
          </p>
        </div>
        <div
          className="flex min-w-0 flex-1 overflow-x-auto"
          style={{ justifyContent: "safe center" }}
        >
          <div className="bg-card/92 no-drag flex items-center gap-0.5 rounded-xl px-1 py-0.5 shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
            {TOOLS.map((item) => (
              <Tip hint={item.hint} key={item.id} label={item.label}>
                <Chip
                  active={toolActive(tool, geo, item.id)}
                  aria-keyshortcuts={item.hint.toLowerCase()}
                  aria-label={item.label}
                  onClick={() => {
                    applyTool(item.id);
                  }}
                >
                  <item.icon />
                </Chip>
              </Tip>
            ))}
            <span className="bg-border mx-0.5 h-4 w-px" />
            {COLORS.map((item) => {
              const hex = palette.colors[item.id].stroke;
              const on = color === item.id;
              return (
                <button
                  aria-label={item.label}
                  aria-pressed={on}
                  className={cn(CHIP, CHIP_HOVER)}
                  key={item.id}
                  onClick={() => {
                    editorRef.current?.setStyle("color", item.id);
                  }}
                  onMouseDown={keepFocus}
                  title={item.label}
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
            {SIZES.map((item, index) => (
              <Tip
                hint={String(index + 1)}
                key={item}
                label={`Size ${index + 1}`}
              >
                <button
                  aria-keyshortcuts={String(index + 1)}
                  aria-label={`Size ${index + 1}`}
                  aria-pressed={size === item}
                  className={cn(
                    CHIP,
                    size === item ? "bg-foreground/10" : CHIP_HOVER
                  )}
                  onClick={() => {
                    applySize(item);
                  }}
                  onMouseDown={keepFocus}
                  type="button"
                >
                  <span
                    className="bg-foreground rounded-full"
                    style={{ height: 4 + index * 3, width: 4 + index * 3 }}
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
                onClick={() => {
                  editorRef.current?.store.undo();
                }}
              >
                <Undo2 />
              </Chip>
            </Tip>
            <Tip hint="⌘⇧Z" label="Redo">
              <Chip
                aria-keyshortcuts="Meta+Shift+Z"
                aria-label="Redo"
                disabled={!canRedo}
                onClick={() => {
                  editorRef.current?.store.redo();
                }}
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
              disabled={!ink}
              onClick={() => {
                copy().catch(() => undefined);
              }}
              onMouseDown={keepFocus}
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
              disabled={!ink}
              onClick={() => {
                save().catch(() => undefined);
              }}
              onMouseDown={keepFocus}
              size="xs"
            >
              {attach || slipId.length > 0 ? "Add" : "Slip"}
              <kbd className="text-[10px] font-medium opacity-70">⌘↵</kbd>
            </Button>
          </div>
        </div>
      </header>
      <div className="no-drag relative min-h-0 flex-1">
        <Quickdraw
          className="size-full"
          grid="dots"
          hideUi
          onMount={mount}
          ref={boardRef}
          styles={{ color: "black", size: "m" }}
          theme={dark ? "dark" : "light"}
          watermark={false}
        />
        {offer === null ? null : (
          <div className="bg-card/92 no-drag absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl px-2 py-1 shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
            <img
              alt=""
              className="size-7 rounded object-contain"
              src={offer.url}
            />
            <p className="text-[12px]">
              {plate === null
                ? "Draw on this image?"
                : "Draw on this image instead?"}
            </p>
            <Button
              className="press"
              onClick={acceptOffer}
              onMouseDown={keepFocus}
              size="xs"
              type="button"
            >
              Use
            </Button>
            <Button
              className="press"
              onClick={dismissOffer}
              onMouseDown={keepFocus}
              size="xs"
              type="button"
              variant="ghost"
            >
              Not now
            </Button>
          </div>
        )}
        <div className="bg-card/92 no-drag absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-lg px-0.5 py-0.5 shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
          <Tip hint="−" label="Zoom out" side="up">
            <Chip
              aria-keyshortcuts="-"
              aria-label="Zoom out"
              disabled={zoom <= ZOOM_MIN}
              onClick={() => {
                zoomFromCenter(1 / ZOOM_STEP);
              }}
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
              onClick={() => {
                zoomFromCenter(ZOOM_STEP);
              }}
            >
              <ZoomIn />
            </Chip>
          </Tip>
        </div>
        <p className="text-muted-foreground pointer-events-none absolute right-3 bottom-3 text-[10px] tracking-wide">
          Space pan
        </p>
      </div>
    </div>
  );
};
