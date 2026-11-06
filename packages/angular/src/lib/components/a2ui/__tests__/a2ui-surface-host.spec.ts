import type { AbstractAgent } from "@ag-ui/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bridgeA2UIAction,
  surfaceHasRenderableContent,
} from "../a2ui-surface-host";
import type { A2UIClientEventMessage } from "../a2ui-types";

describe("bridgeA2UIAction", () => {
  const agent = { agentId: "test" } as AbstractAgent;
  const message: A2UIClientEventMessage = {
    userAction: {
      name: "book_flight",
      surfaceId: "flights",
      sourceComponentId: "book-button",
      timestamp: "2026-11-05T12:00:00.000Z",
      context: { flightNumber: "AA100" },
    },
  };
  let core: {
    properties: Record<string, unknown>;
    setProperties: ReturnType<typeof vi.fn>;
    runAgent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    core = {
      properties: { existing: true },
      setProperties: vi.fn((properties: Record<string, unknown>) => {
        core.properties = properties;
      }),
      runAgent: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("forwards the original message by default and clears the transient action", async () => {
    await bridgeA2UIAction({ core }, agent, message);

    expect(core.setProperties).toHaveBeenNthCalledWith(1, {
      existing: true,
      a2uiAction: message,
    });
    expect(core.runAgent).toHaveBeenCalledExactlyOnceWith({ agent });
    expect(core.properties).toEqual({ existing: true });
  });

  it("handles an action locally when the interceptor returns null", async () => {
    const onAction = vi.fn(() => null);
    await bridgeA2UIAction({ core }, agent, message, onAction);

    expect(onAction).toHaveBeenCalledWith(
      message.userAction,
      expect.any(Function),
    );
    expect(core.runAgent).not.toHaveBeenCalled();
    expect(core.setProperties).not.toHaveBeenCalled();
  });

  it("forwards the original action when the interceptor returns undefined", async () => {
    await bridgeA2UIAction({ core }, agent, message, () => undefined);

    expect(core.setProperties).toHaveBeenNthCalledWith(1, {
      existing: true,
      a2uiAction: message,
    });
    expect(core.runAgent).toHaveBeenCalledTimes(1);
  });

  it("forwards a modified action without changing the original message", async () => {
    const envelope = { ...message, metadata: { source: "chat" } };
    const modified = {
      ...message.userAction,
      context: { ...message.userAction.context, source: "angular" },
    };
    await bridgeA2UIAction({ core }, agent, envelope, () => modified);

    expect(core.setProperties).toHaveBeenNthCalledWith(1, {
      existing: true,
      a2uiAction: { ...envelope, userAction: modified },
    });
    expect(core.runAgent).toHaveBeenCalledTimes(1);
    expect(message.userAction.context).toEqual({ flightNumber: "AA100" });
  });

  it("waits for an async interceptor before forwarding", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onAction = vi.fn(async () => {
      await ready;
    });
    const pending = bridgeA2UIAction({ core }, agent, message, onAction);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(core.runAgent).not.toHaveBeenCalled();
    expect(core.setProperties).not.toHaveBeenCalled();
    release();
    await pending;

    expect(core.runAgent).toHaveBeenCalledTimes(1);
    expect(core.properties).toEqual({ existing: true });
  });

  it("does not forward after an async interceptor handles the action locally", async () => {
    await bridgeA2UIAction({ core }, agent, message, async () => null);

    expect(core.runAgent).not.toHaveBeenCalled();
    expect(core.setProperties).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "supports manual forwarding (modified: %s) without running twice",
    async (modify) => {
      const modified = { ...message.userAction, name: "confirm_booking" };
      await bridgeA2UIAction(
        { core },
        agent,
        message,
        async (_action, forward) => {
          await forward(modify ? modified : undefined);
          return null;
        },
      );

      expect(core.runAgent).toHaveBeenCalledTimes(1);
      expect(core.setProperties).toHaveBeenNthCalledWith(1, {
        existing: true,
        a2uiAction: modify ? { ...message, userAction: modified } : message,
      });
      expect(core.properties).toEqual({ existing: true });
    },
  );

  it("cleans up after an agent failure and preserves other property updates", async () => {
    const error = new Error("Agent failed");
    core.runAgent.mockImplementation(async () => {
      core.properties = { ...core.properties, updated: true };
      throw error;
    });

    await expect(bridgeA2UIAction({ core }, agent, message)).rejects.toBe(
      error,
    );

    expect(core.properties).toEqual({ existing: true, updated: true });
  });

  it("does not forward if the interceptor rejects", async () => {
    const error = new Error("Local handling failed");
    await expect(
      bridgeA2UIAction({ core }, agent, message, async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(core.runAgent).not.toHaveBeenCalled();
    expect(core.setProperties).not.toHaveBeenCalled();
  });

  it("does nothing without a core or agent", async () => {
    const onAction = vi.fn();
    await bridgeA2UIAction(undefined, agent, message, onAction);
    await bridgeA2UIAction({ core }, undefined, message, onAction);

    expect(onAction).not.toHaveBeenCalled();
    expect(core.runAgent).not.toHaveBeenCalled();
  });
});

describe("surfaceHasRenderableContent", () => {
  it("accepts static components and waits for populated data-bound surfaces", () => {
    expect(
      surfaceHasRenderableContent([
        {
          updateComponents: {
            surfaceId: "static",
            components: [{ id: "root", component: "Text", text: "Ready" }],
          },
        },
      ]),
    ).toBe(true);

    const boundComponents = {
      updateComponents: {
        surfaceId: "bound",
        components: [
          { id: "root", component: "List", children: { path: "/items" } },
        ],
      },
    };
    expect(surfaceHasRenderableContent([boundComponents])).toBe(false);
    expect(
      surfaceHasRenderableContent([
        boundComponents,
        {
          updateDataModel: {
            surfaceId: "bound",
            path: "/",
            value: { items: [{ name: "Ready" }] },
          },
        },
      ]),
    ).toBe(true);
  });
});
