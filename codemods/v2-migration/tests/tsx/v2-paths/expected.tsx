"use client";
import {
  CopilotChat,
  CopilotKit,
  type CopilotKitProps,
} from "@copilotkit/react-core";
import { useHeadlessChat } from "@copilotkit/react-core/headless";
import "@copilotkit/react-core/styles.css";

export function App(props: CopilotKitProps) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" {...props}>
      <CopilotChat />
    </CopilotKit>
  );
}

export const lazy = () => import("@copilotkit/react-core/generative-ui");
vi.mock("@copilotkit/react-core", async () => ({}));
