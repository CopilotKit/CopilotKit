import React, { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { ToolCallStatus } from "@copilotkitnext/core";
import { useFrontendTool } from "../use-frontend-tool";

jest.mock("@copilotkitnext/react", () => {
  let currentRender: any = null;
  const listeners = new Set<() => void>();

  return {
    useFrontendTool: jest.fn((tool: { render?: any }) => {
      React.useEffect(() => {
        currentRender = tool.render ?? null;
        listeners.forEach((listener) => listener());
      }, [tool.render]);
    }),
    __getCurrentRender: () => currentRender,
    __subscribeRender: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

const toolRenderModule = jest.requireMock("@copilotkitnext/react") as {
  __getCurrentRender: () => any;
  __subscribeRender: (listener: () => void) => () => void;
};

function ToolRenderHost() {
  const render = React.useSyncExternalStore(
    toolRenderModule.__subscribeRender,
    toolRenderModule.__getCurrentRender,
    toolRenderModule.__getCurrentRender,
  );

  if (!render) {
    return null;
  }

  const RenderComponent = render;
  return (
    <RenderComponent
      name="actionOne"
      args={{}}
      status={ToolCallStatus.InProgress}
      result={undefined}
    />
  );
}

function RunActionButton({ onMount, onUnmount }: { onMount: jest.Mock; onUnmount: jest.Mock }) {
  useEffect(() => {
    onMount();
    return () => onUnmount();
  }, [onMount, onUnmount]);

  return <div data-testid="run-action">Run</div>;
}

describe("useFrontendTool dependency changes", () => {
  it("should not remount rendered tool UI when deps change", async () => {
    const mounted = jest.fn();
    const unmounted = jest.fn();

    const ToolUser = ({ version }: { version: number }) => {
      useFrontendTool(
        {
          name: "actionOne",
          description: "Execute action one",
          render: () => <RunActionButton onMount={mounted} onUnmount={unmounted} />,
        },
        [version],
      );

      return <ToolRenderHost />;
    };

    const ui = render(<ToolUser version={0} />);

    await waitFor(() => {
      expect(mounted).toHaveBeenCalledTimes(1);
    });

    ui.rerender(<ToolUser version={1} />);

    await waitFor(() => {
      expect(unmounted).toHaveBeenCalledTimes(0);
      expect(mounted).toHaveBeenCalledTimes(1);
    });
  });
});
