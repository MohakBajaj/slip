import path from "node:path";

import { app, nativeImage } from "electron";

import { dockIconName } from "../shared/dock-icon";

const dockFile = (name: string): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "dock", name);
  }
  return path.join(__dirname, "../../resources/dock", name);
};

export const applyDockIcon = (dark: boolean): void => {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }
  const image = nativeImage.createFromPath(dockFile(dockIconName(dark)));
  if (!image.isEmpty()) {
    app.dock.setIcon(image);
  }
};
