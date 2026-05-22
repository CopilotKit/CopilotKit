/**
 * Standalone Vite entry point for the Timeline demo.
 *
 * Vite's multi-page mode picks up sibling HTML files automatically (this
 * project ships `index.html` for the M0 SPA and `timeline-demo.html` for
 * the M5 demo). Visit `/timeline-demo.html` while running `nx run
 * @copilotkit/studio:dev:spa` (or `pnpm dev:spa` from the studio dir) to
 * see the drawer in isolation.
 *
 * The demo is intentionally NOT wired into `App.tsx` — that's M7's job. We
 * just need a tiny harness for visual review.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TimelineDemo } from "./components/timeline.demo.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error(
    "CopilotKit Studio (timeline demo): #root container not found in timeline-demo.html",
  );
}

createRoot(container).render(
  <StrictMode>
    <TimelineDemo />
  </StrictMode>,
);
