// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// V2 conversion of the previous render-only `useRenderTool`. Now a proper
// frontend tool with a handler that returns mock pollen data; the render is
// still an imported component (multi-hop import path through
// `./shared/PollenReport` → `./shared/pollen-copy`).
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { PollenReport } from "./shared/PollenReport";
import { mockPollen } from "./shared/mock-weather";

export function ImportedPollenReport() {
  useFrontendTool({
    name: "displayPollenReport",
    followUp: false,
    description:
      "Render a pollen-report card (tree / grass / weed bars, 0–10) for a city. UI TOOL — does not fetch live pollen data. Pass numeric levels if you have them; otherwise the renderer uses a deterministic placeholder.",
    parameters: z.object({
      city: z.string(),
      tree: z.number().min(0).max(10).optional(),
      grass: z.number().min(0).max(10).optional(),
      weed: z.number().min(0).max(10).optional(),
    }),
    handler: async ({ city, tree, grass, weed }) => {
      const base = mockPollen(city);
      return {
        ...base,
        ...(tree !== undefined ? { tree } : {}),
        ...(grass !== undefined ? { grass } : {}),
        ...(weed !== undefined ? { weed } : {}),
      };
    },
    render: PollenReport,
  });
  return null;
}

export default ImportedPollenReport;
