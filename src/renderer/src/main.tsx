import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./app";
import { PreviewApp } from "./preview";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("missing #root");
}

const preview = window.location.hash === "#preview";

createRoot(root).render(
  <StrictMode>{preview ? <PreviewApp /> : <App />}</StrictMode>
);
