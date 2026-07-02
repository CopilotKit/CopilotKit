"use client";

// @region[suppress-catchall-renderer]
import { useDefaultRenderTool } from "@copilotkit/react-core/v2";

export function useSuppressCatchAllToolRendering() {
  useDefaultRenderTool({
    render: ({ name, parameters, status, result }) => null,
  });
}
// @endregion[suppress-catchall-renderer]
