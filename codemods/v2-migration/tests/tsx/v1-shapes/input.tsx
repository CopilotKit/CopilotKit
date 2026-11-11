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
