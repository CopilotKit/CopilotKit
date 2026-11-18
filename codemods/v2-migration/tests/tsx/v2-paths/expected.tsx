"use client";
import {
  CopilotChat,
  CopilotKitProvider,
  type CopilotKitProviderProps,
} from "@copilotkit/react-core";
import { useHeadlessChat } from "@copilotkit/react-core/headless";

export function App(props: CopilotKitProviderProps) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" {...props}>
      <CopilotChat />
    </CopilotKitProvider>
  );
}

export const lazy = () => import("@copilotkit/react-core/generative-ui");
vi.mock("@copilotkit/react-core", async () => ({}));
