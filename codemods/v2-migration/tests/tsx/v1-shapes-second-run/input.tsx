import { z } from "zod";
import {
  useFrontendTool,
  useHumanInTheLoop,
  useRenderToolCall,
} from "@copilotkit/react-core";

const pickSchema = z.object({ option: z.string() });

// Already on the 2.0 API: schemas, and the low-level useRenderToolCall.
export function Tools() {
  useHumanInTheLoop({
    name: "confirm",
    parameters: z.object({ plan: z.string() }),
    render: () => null,
  });
  useFrontendTool({ name: "pick", parameters: pickSchema, handler: () => {} });
  useFrontendTool({ name: "ping", handler: () => {} });
  const renderToolCall = useRenderToolCall();
  return renderToolCall;
}
