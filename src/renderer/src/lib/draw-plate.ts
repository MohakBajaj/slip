import type { Editor } from "@quickdrawjs/core";

import type { Rect } from "../../../shared/annotate";

export interface PlateLayer {
  frame: Rect;
  img: CanvasImageSource;
}

type GridPaint = (
  ctx: CanvasRenderingContext2D,
  cam: { x: number; y: number; z: number },
  width: number,
  height: number,
  ratio: number
) => void;

const isGridPaint = (value: unknown): value is GridPaint =>
  typeof value === "function";

/**
 * Draw the annotation image under the ink. Quickdraw's scene pass fills the
 * paper before shapes, so the image is composited behind the ink and the
 * paper fills whatever the image does not cover.
 */
export const installPlateLayer = (
  editor: Editor,
  plate: () => PlateLayer | null
): void => {
  const base = editor.renderScene.bind(editor);
  editor.renderScene = (ctx, cam, w, h, opts) => {
    const under = plate();
    if (
      !under ||
      under.frame.w <= 0 ||
      under.frame.h <= 0 ||
      opts?.background === false
    ) {
      base(ctx, cam, w, h, opts);
      return;
    }
    const dpr = opts?.dpr ?? 1;
    base(ctx, cam, w, h, { ...opts, background: false });
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.setTransform(
      cam.z * dpr,
      0,
      0,
      cam.z * dpr,
      cam.x * cam.z * dpr,
      cam.y * cam.z * dpr
    );
    ctx.drawImage(
      under.img,
      under.frame.x,
      under.frame.y,
      under.frame.w,
      under.frame.h
    );
    ctx.restore();
    const drawGrid: unknown = Reflect.get(editor, "_drawGrid");
    if (isGridPaint(drawGrid)) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "destination-over";
      Reflect.apply(drawGrid, editor, [ctx, cam, w * dpr, h * dpr, dpr]);
      ctx.restore();
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = editor.theme.background;
    ctx.fillRect(0, 0, w * dpr, h * dpr);
    ctx.restore();
  };
};
