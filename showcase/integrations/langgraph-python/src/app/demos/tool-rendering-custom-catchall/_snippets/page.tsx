"use client";

// Docs-only snippet source. This private App Router folder is not routed by
// Next.js; shell-docs extracts the region below for the catch-all rendering
// guide while the live demo in ../page.tsx keeps its custom catch-all renderer.

// @region[suppress-catchall-rendering]
import { useDefaultRenderTool } from "@copilotkit/react-core/v2";

export function ToolRenderingRegistration() {
  useDefaultRenderTool({
    render: ({ name, parameters, status, result }) => null,
  });

  return null;
}
// @endregion[suppress-catchall-rendering]
