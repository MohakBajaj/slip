import "./index.css";
import { StrictMode } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("missing #root");
}

const page = async (): Promise<ReactElement> => {
  const { hash } = window.location;
  if (hash === "#preview") {
    const { PreviewApp } = await import("./preview");
    return <PreviewApp />;
  }
  if (hash === "#draw") {
    const { DrawApp } = await import("./draw");
    return <DrawApp />;
  }
  if (hash === "#voice") {
    const { VoiceApp } = await import("./voice");
    return <VoiceApp />;
  }
  const { default: App } = await import("./app");
  return <App />;
};

const boot = async (): Promise<void> => {
  try {
    const node = await page();
    createRoot(root).render(<StrictMode>{node}</StrictMode>);
  } catch {
    // keep the page blank
  }
};

void boot();
