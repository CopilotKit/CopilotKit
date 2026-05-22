/**
 * Auxiliary entry point for visual verification of the M4 ArgForm.
 *
 * Mounted at `/demo.html` by Vite's multi-entry handling — does NOT replace
 * the main SPA entry (`main.tsx` / `index.html`). Removing this file (and
 * `demo.html`) has zero effect on the production build, which is keyed off
 * `index.html`.
 *
 * Why this exists: M4's exit criterion 1 ("the demo mounts successfully and
 * renders forms for all parameter types") needs a runnable harness without
 * touching `App.tsx` (M7's integration point) or `main.tsx`.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ArgFormDemo } from "./components/arg-form.demo.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("CopilotKit Studio: #root container not found in demo.html");
}

createRoot(container).render(
  <StrictMode>
    <ArgFormDemo />
  </StrictMode>,
);
