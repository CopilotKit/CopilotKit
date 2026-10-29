import {
  useCopilotReadable,
  useCopilotAction,
  useCoAgent,
  useThreads,
  useFrontendTool,
} from "@copilotkit/react-core";
import type { FrontendAction } from "@copilotkit/react-core";

export function Tools({ items }: { items: string[] }) {
  useCopilotReadable({ description: "items", value: items });
  const { state } = useCoAgent({ name: "agent" });
  useThreads();
  return null;
}
