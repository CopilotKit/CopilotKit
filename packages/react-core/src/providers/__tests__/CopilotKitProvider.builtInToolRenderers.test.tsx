import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolCall } from "@ag-ui/core";
import { GENERATIVE_UI_RENDER_TOOL } from "@copilotkit/shared";
import type { CopilotKitCoreReact } from "../../lib/react-core";
import { useRenderToolCall } from "../../hooks/use-render-tool-call";
import { standardUI } from "../../generative-ui";
import type { ReactToolCallRenderer } from "../../types";
import type { ReactFrontendTool } from "../../types/frontend-tool";
import type { ReactHumanInTheLoop } from "../../types/human-in-the-loop";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";

// The built-in tool renderer (generative UI's `render_ui`) used to rebuild the
// provider's renderer list from a field that no longer exists, so turning the
// feature on erased the app's renderers.

const generativeUI = { ui: standardUI };

function toolCall(name: string): ToolCall {
  return {
    id: `call-${name}`,
    type: "function",
    function: { name, arguments: "{}" },
  };
}

function ToolCallProbe({ name }: { name: string }) {
  const renderToolCall = useRenderToolCall();
  return <>{renderToolCall({ toolCall: toolCall(name) })}</>;
}

let core: CopilotKitCoreReact | null = null;
function CoreCapture() {
  core = useCopilotKit().copilotkit;
  return null;
}

const weatherRenderer: ReactToolCallRenderer<any> = {
  name: "weather",
  args: z.any(),
  render: () => <div data-testid="weather-card">weather</div>,
};

const searchTool: ReactFrontendTool = {
  name: "search",
  parameters: z.object({}),
  handler: async () => "ok",
  render: () => <div data-testid="search-card">search</div>,
};

const approveTool: ReactHumanInTheLoop = {
  name: "approve",
  parameters: z.object({}),
  render: () => <div data-testid="approve-card">approve</div>,
};

function rendererNames() {
  return core!.renderToolCalls.map((renderer) => renderer.name);
}

describe("CopilotKitProvider built-in tool renderers", () => {
  it("keeps the app's renderers when generative UI is active", async () => {
    render(
      <CopilotKitProvider
        generativeUI={generativeUI}
        renderToolCalls={[weatherRenderer]}
        frontendTools={[searchTool]}
        humanInTheLoop={[approveTool]}
      >
        <CoreCapture />
        <ToolCallProbe name="weather" />
        <ToolCallProbe name="search" />
        <ToolCallProbe name="approve" />
      </CopilotKitProvider>,
    );

    await waitFor(() =>
      expect(rendererNames()).toContain(GENERATIVE_UI_RENDER_TOOL),
    );
    expect(screen.getByTestId("weather-card").textContent).toBe("weather");
    expect(screen.getByTestId("search-card").textContent).toBe("search");
    expect(screen.getByTestId("approve-card").textContent).toBe("approve");
  });

  it("lets an app renderer for render_ui win over the built-in one", async () => {
    render(
      <CopilotKitProvider
        generativeUI={generativeUI}
        renderToolCalls={[
          {
            name: GENERATIVE_UI_RENDER_TOOL,
            args: z.any(),
            render: () => <div data-testid="custom-render-ui">custom</div>,
          },
        ]}
      >
        <ToolCallProbe name={GENERATIVE_UI_RENDER_TOOL} />
      </CopilotKitProvider>,
    );

    expect((await screen.findByTestId("custom-render-ui")).textContent).toBe(
      "custom",
    );
  });

  it("keeps the built-in renderer when the provider's renderers change", async () => {
    const { rerender } = render(
      <CopilotKitProvider
        generativeUI={generativeUI}
        renderToolCalls={[weatherRenderer]}
      >
        <CoreCapture />
      </CopilotKitProvider>,
    );
    await waitFor(() =>
      expect(rendererNames()).toContain(GENERATIVE_UI_RENDER_TOOL),
    );

    rerender(
      <CopilotKitProvider
        generativeUI={generativeUI}
        renderToolCalls={[{ ...weatherRenderer }]}
        frontendTools={[searchTool]}
      >
        <CoreCapture />
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(rendererNames()).toContain("search"));
    expect(rendererNames()).toContain(GENERATIVE_UI_RENDER_TOOL);
  });

  it("removes the built-in renderer when generative UI turns off", async () => {
    // The same array on both renders, so only the built-in cleanup can remove
    // the renderer.
    const renderToolCalls = [weatherRenderer];
    const { rerender } = render(
      <CopilotKitProvider
        generativeUI={generativeUI}
        renderToolCalls={renderToolCalls}
      >
        <CoreCapture />
      </CopilotKitProvider>,
    );
    await waitFor(() =>
      expect(rendererNames()).toContain(GENERATIVE_UI_RENDER_TOOL),
    );

    rerender(
      <CopilotKitProvider renderToolCalls={renderToolCalls}>
        <CoreCapture />
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(rendererNames()).toEqual(["weather"]));
  });
});
