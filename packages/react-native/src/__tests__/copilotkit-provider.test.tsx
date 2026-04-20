import React, { useContext } from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// vi.hoisted runs before vi.mock factories, making these available to both
const hoisted = vi.hoisted(() => {
  const _React = require("react");
  return {
    RealContext: _React.createContext(null),
    MockCoreConstructor: vi.fn(),
  };
});

// Captured subscribers from copilotkit.subscribe()
let capturedSubscriber: Record<string, (...args: any[]) => void>;
let unsubscribeMock: ReturnType<typeof vi.fn>;

function createMockCore() {
  return {
    subscribe: vi.fn((subscriber: any) => {
      capturedSubscriber = subscriber;
      return { unsubscribe: unsubscribeMock };
    }),
    setRuntimeUrl: vi.fn(),
    setRuntimeTransport: vi.fn(),
    setHeaders: vi.fn(),
    setProperties: vi.fn(),
  };
}

let mockCoreInstance: ReturnType<typeof createMockCore>;

vi.mock("@copilotkit/react-core/v2/headless", () => {
  // Regular function (not arrow) so it's new-able
  function CopilotKitCoreReact(this: any, ...args: any[]) {
    hoisted.MockCoreConstructor(...args);
    const instance = hoisted.MockCoreConstructor.mock.results.at(-1)?.value;
    if (instance) Object.assign(this, instance);
  }
  return { CopilotKitCoreReact };
});

vi.mock("@copilotkit/react-core/v2/context", () => {
  const _React = require("react");
  return {
    CopilotKitContext: hoisted.RealContext,
    LicenseContext: _React.createContext({
      status: null,
      license: null,
      checkFeature: () => true,
      getLimit: () => null,
    }),
    useLicenseContext: () => ({
      status: null,
      license: null,
      checkFeature: () => true,
      getLimit: () => null,
    }),
  };
});

vi.mock("@copilotkit/shared", () => ({
  createLicenseContextValue: () => ({
    status: null,
    license: null,
    checkFeature: () => true,
    getLimit: () => null,
  }),
}));

// Import after mocks
import { CopilotKitProvider } from "../CopilotKitProvider";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ContextReader({ onContext }: { onContext: (ctx: any) => void }) {
  const ctx = useContext(hoisted.RealContext);
  onContext(ctx);
  return null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CopilotKitProvider (React Native)", () => {
  beforeEach(() => {
    unsubscribeMock = vi.fn();
    mockCoreInstance = createMockCore();
    hoisted.MockCoreConstructor.mockClear();
    hoisted.MockCoreConstructor.mockReturnValue(mockCoreInstance);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Initialization ──────────────────────────────────────────────────────

  describe("initialization", () => {
    it("creates CopilotKitCoreReact with correct config", () => {
      render(
        <CopilotKitProvider
          runtimeUrl="https://api.test"
          headers={{ auth: "token" }}
          properties={{ key: "val" }}
        >
          <div />
        </CopilotKitProvider>,
      );

      expect(hoisted.MockCoreConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeUrl: "https://api.test",
          runtimeTransport: "single",
          headers: { auth: "token" },
          properties: { key: "val" },
        }),
      );
    });

    it("creates exactly one instance across re-renders", () => {
      const { rerender } = render(
        <CopilotKitProvider runtimeUrl="https://api.test/v1">
          <div />
        </CopilotKitProvider>,
      );

      rerender(
        <CopilotKitProvider runtimeUrl="https://api.test/v2">
          <div />
        </CopilotKitProvider>,
      );

      expect(hoisted.MockCoreConstructor).toHaveBeenCalledTimes(1);
    });

    it("maps useSingleEndpoint=true to transport 'single'", () => {
      render(
        <CopilotKitProvider runtimeUrl="https://api.test" useSingleEndpoint>
          <div />
        </CopilotKitProvider>,
      );
      expect(hoisted.MockCoreConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ runtimeTransport: "single" }),
      );
    });

    it("maps useSingleEndpoint=false to transport 'rest'", () => {
      render(
        <CopilotKitProvider
          runtimeUrl="https://api.test"
          useSingleEndpoint={false}
        >
          <div />
        </CopilotKitProvider>,
      );
      expect(hoisted.MockCoreConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ runtimeTransport: "rest" }),
      );
    });

    it("defaults useSingleEndpoint to true", () => {
      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <div />
        </CopilotKitProvider>,
      );
      expect(hoisted.MockCoreConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ runtimeTransport: "single" }),
      );
    });
  });

  // ── Prop synchronization ────────────────────────────────────────────────

  describe("prop synchronization", () => {
    it("calls setRuntimeUrl when runtimeUrl changes", () => {
      const { rerender } = render(
        <CopilotKitProvider runtimeUrl="https://api.test/v1">
          <div />
        </CopilotKitProvider>,
      );

      rerender(
        <CopilotKitProvider runtimeUrl="https://api.test/v2">
          <div />
        </CopilotKitProvider>,
      );

      expect(mockCoreInstance.setRuntimeUrl).toHaveBeenCalledWith(
        "https://api.test/v2",
      );
    });

    it("calls setHeaders when headers content changes", () => {
      const { rerender } = render(
        <CopilotKitProvider runtimeUrl="https://api.test" headers={{ a: "1" }}>
          <div />
        </CopilotKitProvider>,
      );

      mockCoreInstance.setHeaders.mockClear();

      rerender(
        <CopilotKitProvider runtimeUrl="https://api.test" headers={{ b: "2" }}>
          <div />
        </CopilotKitProvider>,
      );

      expect(mockCoreInstance.setHeaders).toHaveBeenCalledWith({ b: "2" });
    });

    it("does not re-fire setHeaders when content is identical (JSON-stabilized)", () => {
      const { rerender } = render(
        <CopilotKitProvider runtimeUrl="https://api.test" headers={{ a: "1" }}>
          <div />
        </CopilotKitProvider>,
      );

      mockCoreInstance.setHeaders.mockClear();

      // New object reference but same content
      rerender(
        <CopilotKitProvider runtimeUrl="https://api.test" headers={{ a: "1" }}>
          <div />
        </CopilotKitProvider>,
      );

      expect(mockCoreInstance.setHeaders).not.toHaveBeenCalled();
    });
  });

  // ── Context provision ─────────────────────────────────────────────────

  describe("context provision", () => {
    it("provides copilotkit and executingToolCallIds via context", () => {
      let ctx: any = null;
      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <ContextReader onContext={(c) => (ctx = c)} />
        </CopilotKitProvider>,
      );

      expect(ctx).not.toBeNull();
      // Structural equality — the `new` constructor copies props via Object.assign
      expect(ctx.copilotkit).toEqual(mockCoreInstance);
      expect(ctx.executingToolCallIds).toBeInstanceOf(Set);
      expect(ctx.executingToolCallIds.size).toBe(0);
    });
  });

  // ── Tool execution tracking ─────────────────────────────────────────────

  describe("tool execution tracking", () => {
    it("adds toolCallId on onToolExecutionStart", () => {
      let ctx: any = null;
      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <ContextReader onContext={(c) => (ctx = c)} />
        </CopilotKitProvider>,
      );

      act(() => {
        capturedSubscriber.onToolExecutionStart({ toolCallId: "tc-1" });
      });

      expect(ctx.executingToolCallIds.has("tc-1")).toBe(true);
    });

    it("removes toolCallId on onToolExecutionEnd", () => {
      let ctx: any = null;
      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <ContextReader onContext={(c) => (ctx = c)} />
        </CopilotKitProvider>,
      );

      act(() => {
        capturedSubscriber.onToolExecutionStart({ toolCallId: "tc-1" });
      });
      act(() => {
        capturedSubscriber.onToolExecutionEnd({ toolCallId: "tc-1" });
      });

      expect(ctx.executingToolCallIds.has("tc-1")).toBe(false);
    });

    it("handles multiple concurrent tool executions", () => {
      let ctx: any = null;
      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <ContextReader onContext={(c) => (ctx = c)} />
        </CopilotKitProvider>,
      );

      act(() => {
        capturedSubscriber.onToolExecutionStart({ toolCallId: "tc-1" });
        capturedSubscriber.onToolExecutionStart({ toolCallId: "tc-2" });
      });

      expect(ctx.executingToolCallIds.size).toBe(2);

      act(() => {
        capturedSubscriber.onToolExecutionEnd({ toolCallId: "tc-1" });
      });

      expect(ctx.executingToolCallIds.has("tc-1")).toBe(false);
      expect(ctx.executingToolCallIds.has("tc-2")).toBe(true);
    });

    it("is idempotent for duplicate start events", () => {
      let ctx: any = null;
      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <ContextReader onContext={(c) => (ctx = c)} />
        </CopilotKitProvider>,
      );

      act(() => {
        capturedSubscriber.onToolExecutionStart({ toolCallId: "tc-1" });
        capturedSubscriber.onToolExecutionStart({ toolCallId: "tc-1" });
      });

      expect(ctx.executingToolCallIds.size).toBe(1);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe("error handling", () => {
    it("forwards errors to onError prop when provided", () => {
      const onError = vi.fn();
      render(
        <CopilotKitProvider runtimeUrl="https://api.test" onError={onError}>
          <div />
        </CopilotKitProvider>,
      );

      const testError = new Error("test error");
      act(() => {
        capturedSubscriber.onError({
          error: testError,
          code: "RUNTIME_ERROR",
          context: { detail: "info" },
        });
      });

      expect(onError).toHaveBeenCalledWith({
        error: testError,
        code: "RUNTIME_ERROR",
        context: { detail: "info" },
      });
    });

    it("logs to console.error when onError is not provided", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <div />
        </CopilotKitProvider>,
      );

      act(() => {
        capturedSubscriber.onError({
          error: new Error("fail"),
          code: "AGENT_ERROR",
          context: {},
        });
      });

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("AGENT_ERROR"),
        expect.any(Error),
        expect.any(Object),
      );
      spy.mockRestore();
    });

    it("picks up new onError callback without resubscribing (ref pattern)", () => {
      const onError1 = vi.fn();
      const onError2 = vi.fn();

      const { rerender } = render(
        <CopilotKitProvider runtimeUrl="https://api.test" onError={onError1}>
          <div />
        </CopilotKitProvider>,
      );

      rerender(
        <CopilotKitProvider runtimeUrl="https://api.test" onError={onError2}>
          <div />
        </CopilotKitProvider>,
      );

      act(() => {
        capturedSubscriber.onError({
          error: new Error("test"),
          code: "RUNTIME_ERROR",
          context: {},
        });
      });

      expect(onError1).not.toHaveBeenCalled();
      expect(onError2).toHaveBeenCalled();
    });
  });

  // ── Shape validation ──────────────────────────────────────────────────

  describe("shape validation", () => {
    it("throws when CopilotKitCoreReact instance is missing required methods", () => {
      // Remove a required method
      const brokenCore = createMockCore();
      delete (brokenCore as any).subscribe;
      hoisted.MockCoreConstructor.mockReturnValue(brokenCore);

      expect(() =>
        render(
          <CopilotKitProvider runtimeUrl="https://api.test">
            <div />
          </CopilotKitProvider>,
        ),
      ).toThrow(/shape mismatch/);
    });
  });

  // ── Cleanup ───────────────────────────────────────────────────────────

  describe("cleanup", () => {
    it("unsubscribes when component unmounts", () => {
      const { unmount } = render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <div />
        </CopilotKitProvider>,
      );

      unmount();

      expect(unsubscribeMock).toHaveBeenCalled();
    });
  });
});
