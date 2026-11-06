import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolCall } from "@ag-ui/core";
import { Catalog } from "@copilotkit/a2ui-renderer";
import { GENERATIVE_UI_RENDER_TOOL } from "@copilotkit/shared";
import { ɵRENDER_A2UI_TOOL_NAME as RENDER_A2UI_TOOL_NAME } from "@copilotkit/core";
import type { CopilotKitCoreReact } from "../../lib/react-core";
import { useRenderToolCall } from "../../hooks/use-render-tool-call";
import { standardUI } from "../../generative-ui";
import type { ReactToolCallRenderer } from "../../types";
import type { ReactFrontendTool } from "../../types/frontend-tool";
import type { ReactHumanInTheLoop } from "../../types/human-in-the-loop";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";

// Built-in tool renderers (A2UI's `render_a2ui`, generative UI's `render_ui`)
// used to rebuild the provider's renderer list from a field that no longer
// exists, so turning either feature on erased the app's renderers.

function makeCatalog() {
  return new Catalog("copilotkit://test-catalog", [], []);
}

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
  it("keeps the app's renderers when A2UI is active", async () => {
    render(
      <CopilotKitProvider
        a2ui={{ catalog: makeCatalog() }}
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
      expect(rendererNames()).toContain(RENDER_A2UI_TOOL_NAME),
    );
    expect(screen.getByTestId("weather-card").textContent).toBe("weather");
    expect(screen.getByTestId("search-card").textContent).toBe("search");
    expect(screen.getByTestId("approve-card").textContent).toBe("approve");
  });

  it("keeps the app's renderers when A2UI and generative UI are both active", async () => {
    render(
      <CopilotKitProvider
        a2ui={{ catalog: makeCatalog() }}
        generativeUI={{ ui: standardUI }}
        renderToolCalls={[weatherRenderer]}
      >
        <CoreCapture />
        <ToolCallProbe name="weather" />
      </CopilotKitProvider>,
    );

    await waitFor(() =>
      expect(rendererNames()).toEqual(
        expect.arrayContaining([
          "weather",
          RENDER_A2UI_TOOL_NAME,
          GENERATIVE_UI_RENDER_TOOL,
        ]),
      ),
    );
    expect(screen.getByTestId("weather-card").textContent).toBe("weather");
  });

  it("lets an app renderer for render_a2ui win over the built-in one", async () => {
    render(
      <CopilotKitProvider
        a2ui={{ catalog: makeCatalog() }}
        renderToolCalls={[
          {
            name: RENDER_A2UI_TOOL_NAME,
            args: z.any(),
            render: () => <div data-testid="custom-a2ui">custom</div>,
          },
        ]}
      >
        <ToolCallProbe name={RENDER_A2UI_TOOL_NAME} />
      </CopilotKitProvider>,
    );

    expect((await screen.findByTestId("custom-a2ui")).textContent).toBe(
      "custom",
    );
  });

  it("keeps the built-in renderer when the provider's renderers change", async () => {
    const catalog = makeCatalog();
    const { rerender } = render(
      <CopilotKitProvider
        a2ui={{ catalog }}
        renderToolCalls={[weatherRenderer]}
      >
        <CoreCapture />
      </CopilotKitProvider>,
    );
    await waitFor(() =>
      expect(rendererNames()).toContain(RENDER_A2UI_TOOL_NAME),
    );

    rerender(
      <CopilotKitProvider
        a2ui={{ catalog }}
        renderToolCalls={[{ ...weatherRenderer }]}
        frontendTools={[searchTool]}
      >
        <CoreCapture />
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(rendererNames()).toContain("search"));
    expect(rendererNames()).toContain(RENDER_A2UI_TOOL_NAME);
  });

  it("removes the built-in renderer when A2UI turns off", async () => {
    // The same array on both renders, so only the built-in cleanup can remove
    // the renderer.
    const renderToolCalls = [weatherRenderer];
    const { rerender } = render(
      <CopilotKitProvider
        a2ui={{ catalog: makeCatalog() }}
        renderToolCalls={renderToolCalls}
      >
        <CoreCapture />
      </CopilotKitProvider>,
    );
    await waitFor(() =>
      expect(rendererNames()).toContain(RENDER_A2UI_TOOL_NAME),
    );

    rerender(
      <CopilotKitProvider renderToolCalls={renderToolCalls}>
        <CoreCapture />
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(rendererNames()).toEqual(["weather"]));
  });
});
