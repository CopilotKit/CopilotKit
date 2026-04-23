// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// V2 counterpart to `ImportedAirQuality.tsx`. The `render` is an imported
// component from `./shared/PollenReport`, which itself imports from a
// second helper module — exercising the preview bundler's handling of a
// multi-hop import graph rooted at the hook's render prop.
import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { PollenReport } from "./shared/PollenReport";

export function ImportedPollenReport() {
  useRenderTool({
    name: "pollenReport",
    parameters: z.object({
      city: z.string(),
      tree: z.number().min(0).max(10),
      grass: z.number().min(0).max(10),
      weed: z.number().min(0).max(10),
    }),
    render: PollenReport,
  });
  return null;
}

export default ImportedPollenReport;
