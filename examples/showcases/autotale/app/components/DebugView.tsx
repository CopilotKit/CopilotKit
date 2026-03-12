import { useCopilotContext } from "@copilotkit/react-core";
import { useStory } from "../lib/StoryProvider";

export function DebugView() {
  const { agentState } = useCopilotContext();
  const { outline } = useStory();

  return (
    <div>
      <p>Debug view</p>

      <p>
        <strong>Node:</strong> {agentState?.nodeName}
      </p>
      <p>
        <strong>Outline:</strong> {outline}
      </p>
    </div>
  )
}