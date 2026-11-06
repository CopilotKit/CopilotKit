// TODO(copilotkit-2.0): `useCopilotReadable` was removed in 2.0. Use `useAgentContext` from "@copilotkit/react-core" instead. Its API is different: https://docs.copilotkit.ai/reference/v2/hooks/useAgentContext
// TODO(copilotkit-2.0): `useCopilotReadable`: V2 models readable application state as agent context.
// TODO(copilotkit-2.0): `useCopilotAction` was removed in 2.0. Use `useFrontendTool` from "@copilotkit/react-core" instead. Its API is different: https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
// TODO(copilotkit-2.0): `useCoAgent` was removed in 2.0. Use `useAgent` from "@copilotkit/react-core" instead. Its API is different: https://docs.copilotkit.ai/reference/v2/hooks/useAgent
// TODO(copilotkit-2.0): `useFrontendTool`: The v2 API uses a Zod schema instead of the v1 Parameter[] shape. https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
import {
  useCopilotReadable,
  useCopilotAction,
  useCoAgent,
  useThreads,
  useFrontendTool,
} from "@copilotkit/react-core";
// TODO(copilotkit-2.0): `FrontendAction` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/generative-ui/tool-based
import type { FrontendAction } from "@copilotkit/react-core";

export function Tools({ items }: { items: string[] }) {
  useCopilotReadable({ description: "items", value: items });
  const { state } = useCoAgent({ name: "agent" });
  useThreads();
  return null;
}
