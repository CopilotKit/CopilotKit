"use client"
import { CopilotKit } from "@copilotkit/react-core";
import { useLayout } from "./contexts/LayoutContext";

export default function Wrapper({ children }: { children: React.ReactNode }) {
  const { layoutState } = useLayout()
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={layoutState.agent}>
      {children}
    </CopilotKit>
  )
}