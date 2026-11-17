import {
  CopilotKit,
  CopilotChat,
  useAgent,
  type CopilotKitProviderProps,
} from "@copilotkit/vue";
import type { UseAgentProps } from "@copilotkit/vue";
import { createGenerativeUI, standardUI } from "@copilotkit/vue/generative-ui";
import { GenerativeUIChart } from "@copilotkit/vue/generative-ui/chart";
import { GenerativeUIMap } from "@copilotkit/vue/generative-ui/map";

export { useFrontendTool } from "@copilotkit/vue";
export * from "@copilotkit/vue/generative-ui";

export const ui = createGenerativeUI({ id: "app", extends: [standardUI] });
export const plugins = [GenerativeUIChart, GenerativeUIMap];
export const loadChat = () => import("@copilotkit/vue");

vi.mock("@copilotkit/vue", async () => ({}));
