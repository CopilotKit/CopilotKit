import React from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RenderToolProvider,
  useRenderToolRegistry,
  useRenderToolContext,
} from "../RenderToolContext";

describe("RenderToolContext", () => {
  describe("RenderToolProvider", () => {
    it("renders children", () => {
      const { getByText } = render(
        <RenderToolProvider>
          <span>child content</span>
        </RenderToolProvider>,
      );
      expect(getByText("child content")).toBeTruthy();
    });

    it("provides an initially empty registry", () => {
      let registry: Map<string, any> | null = null;

      function Reader() {
        registry = useRenderToolRegistry();
        return null;
      }

      render(
        <RenderToolProvider>
          <Reader />
        </RenderToolProvider>,
      );

      expect(registry).not.toBeNull();
      expect(registry!.size).toBe(0);
    });
  });

  describe("register and unregister", () => {
    it("register adds a render function to the registry", () => {
      let registry: Map<string, any> | null = null;
      let registerFn: ((name: string, render: any) => () => void) | null = null;

      function Writer() {
        const ctx = useRenderToolContext();
        registerFn = ctx.register;
        return null;
      }

      function Reader() {
        registry = useRenderToolRegistry();
        return null;
      }

      render(
        <RenderToolProvider>
          <Writer />
          <Reader />
        </RenderToolProvider>,
      );

      const renderFn = () => React.createElement("div");

      act(() => {
        registerFn!("test-tool", renderFn);
      });

      expect(registry!.has("test-tool")).toBe(true);
    });

    it("unregister removes the render function", () => {
      let registry: Map<string, any> | null = null;
      let registerFn: ((name: string, render: any) => () => void) | null = null;
      let unregister: (() => void) | null = null;

      function Writer() {
        const ctx = useRenderToolContext();
        registerFn = ctx.register;
        return null;
      }

      function Reader() {
        registry = useRenderToolRegistry();
        return null;
      }

      render(
        <RenderToolProvider>
          <Writer />
          <Reader />
        </RenderToolProvider>,
      );

      const renderFn = () => React.createElement("div");

      act(() => {
        unregister = registerFn!("removal-tool", renderFn);
      });

      expect(registry!.has("removal-tool")).toBe(true);

      act(() => {
        unregister!();
      });

      expect(registry!.has("removal-tool")).toBe(false);
    });

    it("unregister is safe to call if tool was already replaced", () => {
      let registerFn: ((name: string, render: any) => () => void) | null = null;
      let registry: Map<string, any> | null = null;

      function Writer() {
        const ctx = useRenderToolContext();
        registerFn = ctx.register;
        return null;
      }

      function Reader() {
        registry = useRenderToolRegistry();
        return null;
      }

      render(
        <RenderToolProvider>
          <Writer />
          <Reader />
        </RenderToolProvider>,
      );

      const render1 = () => React.createElement("div", null, "v1");
      const render2 = () => React.createElement("div", null, "v2");

      let unregister1: () => void;

      act(() => {
        unregister1 = registerFn!("shared-tool", render1);
      });

      // Re-register with a different render function (simulates a new component mounting)
      act(() => {
        registerFn!("shared-tool", render2);
      });

      // Calling unregister1 should NOT remove the tool because the current
      // render function is render2, not render1
      act(() => {
        unregister1!();
      });

      expect(registry!.has("shared-tool")).toBe(true);
    });
  });

  describe("useSyncExternalStore integration", () => {
    it("returns updated registry after registration", () => {
      let registry: Map<string, any> | null = null;
      let registerFn: ((name: string, render: any) => () => void) | null = null;

      function Writer() {
        const ctx = useRenderToolContext();
        registerFn = ctx.register;
        return null;
      }

      function Reader() {
        registry = useRenderToolRegistry();
        return null;
      }

      render(
        <RenderToolProvider>
          <Writer />
          <Reader />
        </RenderToolProvider>,
      );

      const sizeBefore = registry!.size;

      act(() => {
        registerFn!("tool-a", () => React.createElement("div"));
      });

      // After registration, the registry should contain the new tool
      expect(registry!.has("tool-a")).toBe(true);
      expect(registry!.size).toBe(sizeBefore + 1);
    });

    it("notifies multiple subscribers when registry changes", () => {
      let registry1: Map<string, any> | null = null;
      let registry2: Map<string, any> | null = null;
      let registerFn: ((name: string, render: any) => () => void) | null = null;

      function Writer() {
        const ctx = useRenderToolContext();
        registerFn = ctx.register;
        return null;
      }

      function Reader1() {
        registry1 = useRenderToolRegistry();
        return null;
      }

      function Reader2() {
        registry2 = useRenderToolRegistry();
        return null;
      }

      render(
        <RenderToolProvider>
          <Writer />
          <Reader1 />
          <Reader2 />
        </RenderToolProvider>,
      );

      act(() => {
        registerFn!("multi-sub-tool", () => React.createElement("div"));
      });

      // Both readers should see the same registry
      expect(registry1!.has("multi-sub-tool")).toBe(true);
      expect(registry2!.has("multi-sub-tool")).toBe(true);
      // They should be the exact same reference
      expect(registry1).toBe(registry2);
    });
  });

  describe("error handling", () => {
    it("useRenderToolContext throws outside provider", () => {
      function TestComponent() {
        useRenderToolContext();
        return null;
      }

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow("useRenderTool must be used within a RenderToolProvider");

      spy.mockRestore();
    });

    it("useRenderToolRegistry throws outside provider", () => {
      function TestComponent() {
        useRenderToolRegistry();
        return null;
      }

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow(
        "useRenderToolRegistry must be used within a RenderToolProvider",
      );

      spy.mockRestore();
    });
  });
});
