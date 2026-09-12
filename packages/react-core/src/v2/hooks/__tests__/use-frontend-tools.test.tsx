import React, { useState, useEffect } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { z } from "zod";
import { useFrontendTools } from "../use-frontend-tools";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import type { ReactFrontendTool } from "../../types";
import { CopilotKitCoreReact } from "../../lib/react-core";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";

/**
 * Component that captures the copilotkit core ref for test assertions.
 */
const CoreCapture: React.FC<{
  onCore: (core: CopilotKitCoreReact) => void;
}> = ({ onCore }) => {
  const { copilotkit } = useCopilotKit();
  useEffect(() => {
    onCore(copilotkit);
  }, [copilotkit, onCore]);
  return null;
};

function makeTool(name: string): ReactFrontendTool<{ msg: string }> {
  return {
    name,
    description: `Tool ${name}`,
    parameters: z.object({ msg: z.string() }),
    handler: async () => ({ result: name }),
  };
}

/** Names registered on the core, restricted to the ones a test created. */
function registeredNames(core: CopilotKitCoreReact, prefix: string): string[] {
  return core.tools
    .map((t) => t.name)
    .filter((name) => name.startsWith(prefix))
    .sort();
}

describe("useFrontendTools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers every tool in the array on mount", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolsComponent: React.FC = () => {
      useFrontendTools([
        makeTool("mount_a"),
        makeTool("mount_b"),
        makeTool("mount_c"),
      ]);
      return null;
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <ToolsComponent />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      expect(registeredNames(coreRef!, "mount_")).toEqual([
        "mount_a",
        "mount_b",
        "mount_c",
      ]);
    });

    ui.unmount();
  });

  it("registers nothing for an empty array", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolsComponent: React.FC = () => {
      useFrontendTools([]);
      return null;
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <ToolsComponent />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
    });
    expect(registeredNames(coreRef!, "empty_")).toEqual([]);

    ui.unmount();
  });

  it("treats undefined as an empty array", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolsComponent: React.FC = () => {
      useFrontendTools(undefined);
      return null;
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <ToolsComponent />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
    });

    ui.unmount();
  });

  it("registers a tool added to the array and keeps the existing ones", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const GrowingTools: React.FC = () => {
      const [count, setCount] = useState(2);
      useFrontendTools(
        Array.from({ length: count }, (_, i) => makeTool(`grow_${i}`)),
      );
      return (
        <button data-testid="add" onClick={() => setCount((n) => n + 1)}>
          add
        </button>
      );
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <GrowingTools />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      expect(registeredNames(coreRef!, "grow_")).toEqual(["grow_0", "grow_1"]);
    });

    fireEvent.click(screen.getByTestId("add"));

    await waitFor(() => {
      expect(registeredNames(coreRef!, "grow_")).toEqual([
        "grow_0",
        "grow_1",
        "grow_2",
      ]);
    });

    ui.unmount();
  });

  it("unregisters exactly the tool dropped from the array", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ShrinkingTools: React.FC = () => {
      const [names, setNames] = useState(["drop_a", "drop_b", "drop_c"]);
      useFrontendTools(names.map(makeTool));
      return (
        <button
          data-testid="drop-b"
          onClick={() => setNames((prev) => prev.filter((n) => n !== "drop_b"))}
        >
          drop
        </button>
      );
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <ShrinkingTools />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      expect(registeredNames(coreRef!, "drop_")).toEqual([
        "drop_a",
        "drop_b",
        "drop_c",
      ]);
    });

    fireEvent.click(screen.getByTestId("drop-b"));

    await waitFor(() => {
      expect(registeredNames(coreRef!, "drop_")).toEqual(["drop_a", "drop_c"]);
    });

    ui.unmount();
  });

  it("unregisters every tool on unmount", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolsComponent: React.FC = () => {
      useFrontendTools([makeTool("unmount_a"), makeTool("unmount_b")]);
      return null;
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <ToolsComponent />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      expect(registeredNames(coreRef!, "unmount_")).toEqual([
        "unmount_a",
        "unmount_b",
      ]);
    });

    ui.unmount();

    expect(registeredNames(coreRef!, "unmount_")).toEqual([]);
  });

  it("does not re-register when a re-render produces an equal array", async () => {
    let coreRef: CopilotKitCoreReact | null = null;
    const addTool = vi.spyOn(CopilotKitCoreReact.prototype, "addTool");

    const RerenderingTools: React.FC = () => {
      const [, setTick] = useState(0);
      // A fresh array literal on every render: identity always changes.
      useFrontendTools([makeTool("stable_a"), makeTool("stable_b")]);
      return (
        <button data-testid="tick" onClick={() => setTick((n) => n + 1)}>
          tick
        </button>
      );
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <RerenderingTools />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      expect(registeredNames(coreRef!, "stable_")).toEqual([
        "stable_a",
        "stable_b",
      ]);
    });

    const callsAfterMount = addTool.mock.calls.length;

    fireEvent.click(screen.getByTestId("tick"));
    fireEvent.click(screen.getByTestId("tick"));

    await waitFor(() => {
      expect(registeredNames(coreRef!, "stable_")).toEqual([
        "stable_a",
        "stable_b",
      ]);
    });
    expect(addTool.mock.calls.length).toBe(callsAfterMount);

    ui.unmount();
  });

  it("re-registers when a tool's available flag changes", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const TogglingTools: React.FC = () => {
      const [enabled, setEnabled] = useState(true);
      useFrontendTools([
        { ...makeTool("avail_a"), available: enabled },
        makeTool("avail_b"),
      ]);
      return (
        <button data-testid="toggle" onClick={() => setEnabled((v) => !v)}>
          toggle
        </button>
      );
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <TogglingTools />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      expect(coreRef!.tools.find((t) => t.name === "avail_a")?.available).toBe(
        true,
      );
    });

    fireEvent.click(screen.getByTestId("toggle"));

    await waitFor(() => {
      expect(coreRef!.tools.find((t) => t.name === "avail_a")?.available).toBe(
        false,
      );
    });

    ui.unmount();
  });

  it("registers a renderer only for tools that define render, and keeps it after unmount", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolsComponent: React.FC = () => {
      useFrontendTools([
        { ...makeTool("render_with"), render: () => <div>rendered</div> },
        makeTool("render_without"),
      ]);
      return null;
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <ToolsComponent />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      expect(
        coreRef!.renderToolCalls.some((r) => r.name === "render_with"),
      ).toBe(true);
    });
    expect(
      coreRef!.renderToolCalls.some((r) => r.name === "render_without"),
    ).toBe(false);

    ui.unmount();

    // Renderers survive unmount so past tool calls still render in history.
    expect(coreRef!.renderToolCalls.some((r) => r.name === "render_with")).toBe(
      true,
    );
  });

  it("keeps the last entry and warns when a name is duplicated in one array", async () => {
    let coreRef: CopilotKitCoreReact | null = null;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const ToolsComponent: React.FC = () => {
      useFrontendTools([
        { ...makeTool("dup"), description: "first" },
        { ...makeTool("dup"), description: "second" },
      ]);
      return null;
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <ToolsComponent />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      expect(registeredNames(coreRef!, "dup")).toEqual(["dup"]);
    });

    expect(coreRef!.tools.find((t) => t.name === "dup")?.description).toBe(
      "second",
    );
    expect(
      warn.mock.calls.some(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("listed more than once"),
      ),
    ).toBe(true);

    ui.unmount();
  });

  it("scopes tools by agentId so the same name can serve two agents", async () => {
    let coreRef: CopilotKitCoreReact | null = null;

    const ToolsComponent: React.FC = () => {
      useFrontendTools([
        { ...makeTool("scoped"), agentId: "agent_one" },
        { ...makeTool("scoped"), agentId: "agent_two" },
      ]);
      return null;
    };

    const ui = renderWithCopilotKit({
      children: (
        <>
          <ToolsComponent />
          <CoreCapture
            onCore={(c) => {
              coreRef = c;
            }}
          />
        </>
      ),
    });

    await waitFor(() => {
      expect(coreRef).not.toBeNull();
      expect(coreRef!.tools.filter((t) => t.name === "scoped")).toHaveLength(2);
    });

    ui.unmount();

    expect(coreRef!.tools.filter((t) => t.name === "scoped")).toHaveLength(0);
  });
});
