"use client";
import {
  CopilotChat,
  CopilotKitProvider,
  type CopilotKitProviderProps,
} from "@copilotkit/react-core/v2";
import { useHeadlessChat } from "@copilotkit/react-core/v2/headless";
import "@copilotkit/react-core/v2/styles.css";

export function App(props: CopilotKitProviderProps) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" {...props}>
      <CopilotChat />
    </CopilotKitProvider>
  );
}

export const lazy = () => import("@copilotkit/react-core/v2/generative-ui");
vi.mock("@copilotkit/react-core/v2", async () => ({}));
