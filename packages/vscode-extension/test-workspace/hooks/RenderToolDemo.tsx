import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

export function RenderToolDemo() {
  useRenderTool({
    name: "greetTool",
    parameters: z.object({ name: z.string() }),
    render: ({ parameters, status }) => (
      <div data-testid="greet-tool-render">
        Hello {parameters.name} ({status})
      </div>
    ),
  });
  return null;
}

export default RenderToolDemo;
