import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const rendererSrc = path.resolve("src/renderer/src");

export default defineConfig({
  main: {
    resolve: {
      alias: {
        "@shared": path.resolve("src/shared"),
      },
    },
  },
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": rendererSrc,
        "@renderer": rendererSrc,
        "@shared": path.resolve("src/shared"),
      },
    },
  },
});
