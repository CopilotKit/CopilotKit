import React, { type ReactNode } from "react";
import { render, renderHook, waitFor } from "@testing-library/react";
import { useCoAgentStateRender } from "../use-coagent-state-render";
import type { CoAgentStateRender } from "../../types/coagent-action";
import {
  CoAgentStateRendersProvider,
  CopilotContext,
  useCoAgentStateRenders,
} from "../../context";
import { CopilotKitAgentDiscoveryError, randomId } from "@copilotkit/shared";
import { createTestCopilotContext } from "../../test-helpers/copilot-context";

const addToast = jest.fn();
const setBannerError = jest.fn();

jest.mock("../../components/toast/toast-provider", () => ({
  useToast: () => ({
    addToast,
    setBannerError,
  }),
}));

function createWrapper(copilotContextValue: ReturnType<typeof createTestCopilotContext>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>{children}</CoAgentStateRendersProvider>
      </CopilotContext.Provider>
    );
  };
}

function useHarness<T>(action: Parameters<typeof useCoAgentStateRender<T>>[0], deps?: unknown[]) {
  useCoAgentStateRender(action, deps);
  return useCoAgentStateRenders();
}

function HookUser<T>({
  action,
  deps,
}: {
  action: CoAgentStateRender<T>;
  deps?: unknown[];
}) {
  useCoAgentStateRender(action, deps);
  return null;
}

function getSingleEntry<T>(renders: Record<string, T>) {
  const entries = Object.entries(renders);
  expect(entries).toHaveLength(1);
  return entries[0];
}

describe("useCoAgentStateRender (hook behaviors)", () => {
  let idCounter = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    idCounter = 0;
    (randomId as jest.Mock).mockImplementation(() => `test-random-id-${++idCounter}`);
  });

  it("registers state render and writes to the render cache", async () => {
    const chatComponentsCache = { current: { actions: {}, coAgentStateRenders: {} } };
    const wrapper = createWrapper(
      createTestCopilotContext({
        chatComponentsCache,
      }),
    );

    const renderFn = jest.fn(() => null);

    const { result } = renderHook(
      () =>
        useHarness({
          name: "agent-a",
          nodeName: "node-1",
          render: renderFn,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(Object.keys(result.current.coAgentStateRenders)).toHaveLength(1);
    });

    expect(chatComponentsCache.current.coAgentStateRenders["agent-a-node-1"]).toBe(renderFn);
  });

  it("mutates handler + cache in place when dependencies are omitted", async () => {
    const chatComponentsCache = { current: { actions: {}, coAgentStateRenders: {} } };
    const wrapper = createWrapper(
      createTestCopilotContext({
        chatComponentsCache,
      }),
    );

    const handlerOne = jest.fn();
    const handlerTwo = jest.fn();
    const renderOne = jest.fn(() => null);
    const renderTwo = jest.fn(() => null);

    const { result, rerender } = renderHook(
      ({ handler, renderFn }) =>
        useHarness({
          name: "agent-b",
          handler,
          render: renderFn,
        }),
      {
        wrapper,
        initialProps: { handler: handlerOne, renderFn: renderOne },
      },
    );

    await waitFor(() => {
      expect(Object.keys(result.current.coAgentStateRenders)).toHaveLength(1);
    });

    const initialRenders = result.current.coAgentStateRenders;
    const [id, initialRender] = getSingleEntry(initialRenders);

    expect(initialRender.handler).toBe(handlerOne);
    expect(chatComponentsCache.current.coAgentStateRenders["agent-b-global"]).toBe(renderOne);

    rerender({ handler: handlerTwo, renderFn: renderTwo });

    expect(result.current.coAgentStateRenders).toBe(initialRenders);
    expect(result.current.coAgentStateRenders[id].handler).toBe(handlerTwo);
    expect(chatComponentsCache.current.coAgentStateRenders["agent-b-global"]).toBe(renderTwo);
  });

  it("re-registers when dependencies change", async () => {
    const wrapper = createWrapper(createTestCopilotContext());

    const handlerOne = jest.fn();
    const handlerTwo = jest.fn();

    const { result, rerender } = renderHook(
      ({ deps, handler }) =>
        useHarness(
          {
            name: "agent-c",
            handler,
          },
          deps,
        ),
      {
        wrapper,
        initialProps: { deps: [0], handler: handlerOne },
      },
    );

    await waitFor(() => {
      expect(Object.keys(result.current.coAgentStateRenders)).toHaveLength(1);
    });

    const initialRenders = result.current.coAgentStateRenders;
    const [id] = Object.keys(initialRenders);

    rerender({ deps: [1], handler: handlerTwo });

    await waitFor(() => {
      expect(result.current.coAgentStateRenders).not.toBe(initialRenders);
    });

    expect(result.current.coAgentStateRenders[id].handler).toBe(handlerTwo);
  });

  it("re-registers when string render changes", async () => {
    const chatComponentsCache = { current: { actions: {}, coAgentStateRenders: {} } };
    const wrapper = createWrapper(
      createTestCopilotContext({
        chatComponentsCache,
      }),
    );

    const { result, rerender } = renderHook(
      ({ renderValue }) =>
        useHarness({
          name: "agent-d",
          render: renderValue,
        }),
      {
        wrapper,
        initialProps: { renderValue: "Step 1" },
      },
    );

    await waitFor(() => {
      expect(Object.keys(result.current.coAgentStateRenders)).toHaveLength(1);
    });

    const initialRenders = result.current.coAgentStateRenders;
    rerender({ renderValue: "Step 2" });

    await waitFor(() => {
      expect(result.current.coAgentStateRenders).not.toBe(initialRenders);
    });

    expect(chatComponentsCache.current.coAgentStateRenders["agent-d-global"]).toBe("Step 2");
  });

  it("warns when duplicate registrations target the same agent + node", async () => {
    const copilotContextValue = createTestCopilotContext();

    function DuplicateHarness() {
      return (
        <>
          <HookUser
            action={{
              name: "agent-dup",
              nodeName: "node-x",
              handler: jest.fn(),
            }}
          />
          <HookUser
            action={{
              name: "agent-dup",
              nodeName: "node-x",
              handler: jest.fn(),
            }}
          />
        </>
      );
    }

    render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <DuplicateHarness />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(addToast).toHaveBeenCalled();
    });

    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "warning",
        message:
          "Found multiple state renders for agent agent-dup and node node-x. State renders might get overridden",
      }),
    );
  });

  it("does not warn when duplicate agents target different nodes", async () => {
    const copilotContextValue = createTestCopilotContext();

    function NonDuplicateHarness() {
      return (
        <>
          <HookUser
            action={{
              name: "agent-ok",
              nodeName: "node-a",
              handler: jest.fn(),
            }}
          />
          <HookUser
            action={{
              name: "agent-ok",
              nodeName: "node-b",
              handler: jest.fn(),
            }}
          />
        </>
      );
    }

    render(
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>
          <NonDuplicateHarness />
        </CoAgentStateRendersProvider>
      </CopilotContext.Provider>,
    );

    await waitFor(() => {
      expect(addToast).not.toHaveBeenCalled();
    });
  });

  it("surfaces missing agents in the banner error state", async () => {
    const availableAgents = [{ name: "known-agent", id: "agent-1" }];
    const wrapper = createWrapper(
      createTestCopilotContext({
        availableAgents,
      }),
    );

    renderHook(
      () =>
        useHarness({
          name: "missing-agent",
          handler: jest.fn(),
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(CopilotKitAgentDiscoveryError).toHaveBeenCalledWith({
        agentName: "missing-agent",
        availableAgents: [{ name: "known-agent", id: "agent-1" }],
      });
      expect(setBannerError).toHaveBeenCalled();
    });
  });

  it("does not surface banner errors when agent is available", async () => {
    const availableAgents = [{ name: "agent-present", id: "agent-2" }];
    const wrapper = createWrapper(
      createTestCopilotContext({
        availableAgents,
      }),
    );

    renderHook(
      () =>
        useHarness({
          name: "agent-present",
          handler: jest.fn(),
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(setBannerError).not.toHaveBeenCalled();
    });
  });
});
