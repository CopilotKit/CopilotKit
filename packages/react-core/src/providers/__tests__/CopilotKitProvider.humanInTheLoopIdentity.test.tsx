import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolCall } from "@ag-ui/core";
import type { CopilotKitCoreReact } from "../../lib/react-core";
import { useRenderToolCall } from "../../hooks/use-render-tool-call";
import type { ReactToolCallRenderer } from "../../types";
import type { ReactHumanInTheLoop } from "../../types/human-in-the-loop";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";

// A human-in-the-loop render is wrapped into a tool-call renderer. A new
// wrapper is a new component type, so it must not change when only
// `renderToolCalls` changes, or the card remounts and loses its state.

const approveCall: ToolCall = {
  id: "call-approve",
  type: "function",
  function: { name: "approve", arguments: "{}" },
};

function ApproveProbe() {
  const renderToolCall = useRenderToolCall();
  return <>{renderToolCall({ toolCall: approveCall })}</>;
}

let core: CopilotKitCoreReact | null = null;
function CoreCapture() {
  core = useCopilotKit().copilotkit;
  return null;
}

let approveMounts = 0;
function ApproveCard() {
  useEffect(() => {
    approveMounts += 1;
  }, []);
  return <div data-testid="approve-card">approve</div>;
}

const approveTool: ReactHumanInTheLoop = {
  name: "approve",
  parameters: z.object({}),
  render: ApproveCard,
};
const humanInTheLoop = [approveTool];

function weatherRenderers(): ReactToolCallRenderer<any>[] {
  // A new array and a new renderer each time, as an inline prop gives.
  return [{ name: "weather", args: z.any(), render: () => <div>weather</div> }];
}

function App() {
  return (
    <CopilotKitProvider
      renderToolCalls={weatherRenderers()}
      humanInTheLoop={humanInTheLoop}
    >
      <CoreCapture />
      <ApproveProbe />
    </CopilotKitProvider>
  );
}

describe("CopilotKitProvider human-in-the-loop renderers", () => {
  it("keeps the card mounted and the tools unchanged when only renderToolCalls changes", () => {
    approveMounts = 0;
    const { rerender } = render(<App />);
    expect(screen.getByTestId("approve-card")).toBeTruthy();
    expect(approveMounts).toBe(1);
    const setTools = vi.spyOn(core!, "setTools");

    rerender(<App />);
    rerender(<App />);

    expect(screen.getByTestId("approve-card")).toBeTruthy();
    expect(approveMounts).toBe(1);
    expect(setTools).not.toHaveBeenCalled();
  });
});
