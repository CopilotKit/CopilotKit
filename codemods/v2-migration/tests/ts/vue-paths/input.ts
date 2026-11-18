import { CopilotKit } from "@copilotkit/vue";
import {
  CopilotChat,
  useAgent,
  type CopilotKitProviderProps,
} from "@copilotkit/vue/v2";
import type { UseAgentProps } from "@copilotkit/vue/v2";
import { createGenerativeUI, standardUI } from "@copilotkit/vue/v2/generative-ui";
import { GenerativeUIChart } from "@copilotkit/vue/v2/generative-ui/chart";
import { GenerativeUIMap } from "@copilotkit/vue/v2/generative-ui/map";
import "@copilotkit/vue/styles.css";

export { useFrontendTool } from "@copilotkit/vue/v2";
export * from "@copilotkit/vue/v2/generative-ui";

export const ui = createGenerativeUI({ id: "app", extends: [standardUI] });
export const plugins = [GenerativeUIChart, GenerativeUIMap];
export const loadChat = () => import("@copilotkit/vue/v2");

vi.mock("@copilotkit/vue/v2", async () => ({}));
