import { useRenderTool } from "@copilotkit/react-core/v2";

export function Y() {
  useRenderTool({ name: "v2tool", render: () => <div /> });
  return null;
}
