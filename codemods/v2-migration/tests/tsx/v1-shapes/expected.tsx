// TODO(copilotkit-2.0): `useFrontendTool`: The v2 API uses a Zod schema instead of the v1 Parameter[] shape. https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
// TODO(copilotkit-2.0): `useHumanInTheLoop`: The v2 API uses a Zod schema instead of the v1 Parameter[] shape. https://docs.copilotkit.ai/reference/v2/hooks/useHumanInTheLoop
// TODO(copilotkit-2.0): `useRenderToolCall` was removed in 2.0. Use `useRenderTool` from "@copilotkit/react-core" instead. Its API is different: https://docs.copilotkit.ai/reference/v2/hooks/useRenderTool
// TODO(copilotkit-2.0): `useRenderToolCall`: Use useRenderTool to register a renderer for an existing backend tool in v2.
// TODO(copilotkit-2.0): `useRenderToolCall`: The v2 hook named useRenderToolCall is a different, low-level consumer API.
import {
  useFrontendTool,
  useHumanInTheLoop,
  useRenderToolCall,
} from "@copilotkit/react-core";
import type { Parameter } from "@copilotkit/shared";

const confirmParameters: Parameter[] = [{ name: "plan", type: "string" }];
const pickParameters = [{ name: "option", type: "string" }];

export function Tools() {
  // v1: parameters as a variable typed Parameter[].
  useHumanInTheLoop({
    name: "confirm",
    parameters: confirmParameters,
    render: () => null,
  });
  // v1: parameters as a variable holding an array literal.
  useFrontendTool({
    name: "pick",
    parameters: pickParameters,
    handler: () => {},
  });
  // v1: useRenderToolCall registered a renderer from a config.
  useRenderToolCall({ name: "search", render: () => null });
  return null;
}
