"use client";

// @region[suppress-named-tool-renderer]
import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

export function useSuppressWeatherToolRendering() {
  useRenderTool(
    {
      name: "get_weather",
      parameters: z.object({ location: z.string() }),
      render: ({ name, parameters, status, result }) => null,
    },
    [],
  );
}
// @endregion[suppress-named-tool-renderer]
