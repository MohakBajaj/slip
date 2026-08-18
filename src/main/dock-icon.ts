import path from "node:path";

import { app, nativeImage } from "electron";

const dockFile = (dark: boolean): string => {
  const name = dark ? "dark.png" : "light.png";
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "dock", name);
  }
  return path.join(__dirname, "../../resources/dock", name);
};

export const applyDockIcon = (dark: boolean): void => {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }
  const image = nativeImage.createFromPath(dockFile(dark));
  if (!image.isEmpty()) {
    app.dock.setIcon(image);
  }
};
