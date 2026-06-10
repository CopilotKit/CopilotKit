import { renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import { useOpenGenerativeUIOptions } from "../OpenGenerativeUIOptionsContext";
import { OPEN_GEN_UI_DESIGN_SYSTEM_CSS } from "../../lib/designSystemCss";
import { DEFAULT_OPEN_GEN_UI_LIBRARIES } from "../../lib/assembleDocument";

describe("CopilotKitProvider — openGenerativeUI option-resolution wiring", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Helper: find the design-skill context entry from the context record */
  function findDesignSkillContext(
    ctx: Record<string, { description: string; value: string }>,
  ) {
    return Object.values(ctx).find((c) =>
      c.description.includes("Design guidelines"),
    );
  }

  describe("OpenGenerativeUIOptionsContext resolution", () => {
    it("(a) openGenerativeUI={{}} → designSystemCss equals built-in kit, importMap deep-equals defaults", () => {
      const { result } = renderHook(() => useOpenGenerativeUIOptions(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{}}>
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(result.current.designSystemCss).toBe(
        OPEN_GEN_UI_DESIGN_SYSTEM_CSS,
      );
      expect(result.current.importMap).toEqual(DEFAULT_OPEN_GEN_UI_LIBRARIES);
    });

    it("(b) openGenerativeUI={{ designSystem: false }} → designSystemCss === false", () => {
      const { result } = renderHook(() => useOpenGenerativeUIOptions(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{ designSystem: false }}>
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(result.current.designSystemCss).toBe(false);
    });

    it("(c) openGenerativeUI={{ designSystem: { css: 'X{}' } }} → designSystemCss === 'X{}'", () => {
      const { result } = renderHook(() => useOpenGenerativeUIOptions(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider
            openGenerativeUI={{ designSystem: { css: "X{}" } }}
          >
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(result.current.designSystemCss).toBe("X{}");
    });

    it("(d) openGenerativeUI={{ libraries: false }} → importMap === false", () => {
      const { result } = renderHook(() => useOpenGenerativeUIOptions(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{ libraries: false }}>
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(result.current.importMap).toBe(false);
    });

    it("(e) openGenerativeUI={{ libraries: { foo: 'https://x' } }} → importMap contains 'foo' AND default key 'three' (merge, not replace)", () => {
      const { result } = renderHook(() => useOpenGenerativeUIOptions(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider
            openGenerativeUI={{ libraries: { foo: "https://x" } }}
          >
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(result.current.importMap).not.toBe(false);
      const importMap = result.current.importMap as Record<string, string>;
      expect(importMap).toHaveProperty("foo", "https://x");
      expect(importMap).toHaveProperty("three");
    });
  });

  describe("(f) legacy design-skill guard — agent context registration", () => {
    it("with designSystem: false → design-skill context contains hardcoded palette text", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{ designSystem: false }}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const designContext = findDesignSkillContext(
        result.current.copilotkit.context,
      );
      expect(designContext).toBeDefined();

      // The legacy skill contains hardcoded hex palette and/or "Neutral base palette" text
      const value = designContext!.value;
      const hasHardcodedColor = value.includes("#e5e7eb");
      const hasNeutralText = value.includes("Neutral base palette");
      expect(hasHardcodedColor || hasNeutralText).toBe(true);
    });

    it("with openGenerativeUI={{}} → design-skill context contains token-based var(--color-) references", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{}}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const designContext = findDesignSkillContext(
        result.current.copilotkit.context,
      );
      expect(designContext).toBeDefined();

      // The token-based skill uses CSS custom properties instead of hardcoded colors
      expect(designContext!.value).toContain("var(--color-");
    });
  });
});
