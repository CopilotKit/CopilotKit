"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { createMirrorActivityRenderer } from "@/a2ui/MirrorRenderer";

/* Both agents send A2UI surfaces via activity messages. We intercept those
 * with our mirror renderer and forward them to the page-level SurfaceCanvas,
 * so the dashboard renders at full canvas size instead of as a chat bubble.
 *
 * The pill the renderer leaves behind in chat is the user-visible breadcrumb
 * ("surface → rendered in the canvas"). */
const RENDERERS = [
  createMirrorActivityRenderer("fixed_agent"),
  createMirrorActivityRenderer("dynamic_agent"),
];

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" renderActivityMessages={RENDERERS}>
      {children}
    </CopilotKit>
  );
}
