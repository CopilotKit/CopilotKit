"use client";

import { CopilotKitProvider } from "@copilotkit/react-core";
import { catalog } from "@/a2ui/catalog";

/* `generativeUI` gives every agent our component catalog. Both agents write
 * A2UI v0.9 surfaces; the runtime converts them to generative UI surfaces.
 * The /fixed and /dynamic pages show each surface in the page-level
 * SurfaceCanvas, so the dashboard renders at full canvas size instead of as
 * a chat bubble, and leave a small pill in the chat
 * ("surface → rendered in the canvas") as the user-visible breadcrumb. */
const GENERATIVE_UI = { ui: catalog };

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      generativeUI={GENERATIVE_UI}
    >
      {children}
    </CopilotKitProvider>
  );
}
