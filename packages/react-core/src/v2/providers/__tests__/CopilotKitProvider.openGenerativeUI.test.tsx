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

  describe("(g) custom kit pairs with neutral guidance, not built-in tokens", () => {
    it("custom kit → design-skill context has no built-in token names and tool description advertises the custom-kit line, not built-in tokens/SVG classes", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider
            openGenerativeUI={{ designSystem: { css: ".my-kit{color:red}" } }}
          >
            {children}
          </CopilotKitProvider>
        ),
      });

      // Design-skill context must be the generic legacy skill (no built-in
      // token names a custom kit may not define).
      const designContext = findDesignSkillContext(
        result.current.copilotkit.context,
      );
      expect(designContext).toBeDefined();
      expect(designContext!.value).not.toContain("var(--color-");
      expect(designContext!.value).not.toContain("var(--border-radius-");

      // The generateSandboxedUi tool description must NOT advertise the
      // built-in token/SVG block, but MUST include the neutral custom-kit line.
      const tool = result.current.copilotkit.getTool({
        toolName: "generateSandboxedUi",
      });
      expect(tool).toBeDefined();
      const description = tool!.description!;
      expect(description).not.toContain(".c-purple");
      expect(description).not.toContain("--color-background-primary");
      expect(description).toContain(
        "A custom design system stylesheet is PRE-INJECTED",
      );
    });
  });

  describe("(h) built-in kit advertises the token block in the tool description", () => {
    it("openGenerativeUI={{}} → tool description contains built-in tokens and SVG color ramp classes", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{}}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const tool = result.current.copilotkit.getTool({
        toolName: "generateSandboxedUi",
      });
      expect(tool).toBeDefined();
      const description = tool!.description!;
      expect(description).toContain("--color-background-primary");
      expect(description).toContain(".c-purple");
    });
  });

  describe("(i) designSystem: null resolves to built-in kit without crashing", () => {
    it("null designSystem → no crash, options resolve to the built-in kit, token-based guidance applied", () => {
      const { result } = renderHook(
        () => ({
          options: useOpenGenerativeUIOptions(),
          ck: useCopilotKit(),
        }),
        {
          wrapper: ({ children }) => (
            <CopilotKitProvider
              openGenerativeUI={{ designSystem: null as any }}
            >
              {children}
            </CopilotKitProvider>
          ),
        },
      );

      // Resolves to the built-in kit, exactly like `undefined`.
      expect(result.current.options.designSystemCss).toBe(
        OPEN_GEN_UI_DESIGN_SYSTEM_CSS,
      );

      // And is treated as the built-in kit downstream: token-based design skill
      // and the built-in token/SVG block in the tool description.
      const designContext = findDesignSkillContext(
        result.current.ck.copilotkit.context,
      );
      expect(designContext).toBeDefined();
      expect(designContext!.value).toContain("var(--color-");

      const tool = result.current.ck.copilotkit.getTool({
        toolName: "generateSandboxedUi",
      });
      expect(tool).toBeDefined();
      expect(tool!.description!).toContain("--color-background-primary");
      expect(tool!.description!).toContain(".c-purple");
    });
  });

  describe("(j) degenerate empty object designSystem behaves like the built-in kit", () => {
    it("designSystem: {} → designSystemCss is the built-in kit, description advertises built-in tokens, design skill is token-based", () => {
      const { result } = renderHook(
        () => ({
          options: useOpenGenerativeUIOptions(),
          ck: useCopilotKit(),
        }),
        {
          wrapper: ({ children }) => (
            <CopilotKitProvider openGenerativeUI={{ designSystem: {} as any }}>
              {children}
            </CopilotKitProvider>
          ),
        },
      );

      // A `{}` (no `css` key) carries no custom stylesheet, so the built-in kit
      // is what actually lands in the document.
      expect(result.current.options.designSystemCss).toBe(
        OPEN_GEN_UI_DESIGN_SYSTEM_CSS,
      );

      // Guidance must match the injected kit: built-in token block in the tool
      // description, token-based design skill.
      const tool = result.current.ck.copilotkit.getTool({
        toolName: "generateSandboxedUi",
      });
      expect(tool).toBeDefined();
      expect(tool!.description!).toContain("--color-background-primary");

      const designContext = findDesignSkillContext(
        result.current.ck.copilotkit.context,
      );
      expect(designContext).toBeDefined();
      expect(designContext!.value).toContain("var(--color-");
    });
  });

  describe("(k) whitespace/empty custom css behaves like the built-in kit", () => {
    it('designSystem: { css: "" } → designSystemCss is the built-in kit, description advertises built-in tokens, design skill is token-based', () => {
      const { result } = renderHook(
        () => ({
          options: useOpenGenerativeUIOptions(),
          ck: useCopilotKit(),
        }),
        {
          wrapper: ({ children }) => (
            <CopilotKitProvider
              openGenerativeUI={{ designSystem: { css: "" } }}
            >
              {children}
            </CopilotKitProvider>
          ),
        },
      );

      // An empty custom stylesheet injects nothing, so the built-in kit is the
      // only thing that can land — guidance must reflect that, not a phantom
      // custom stylesheet.
      expect(result.current.options.designSystemCss).toBe(
        OPEN_GEN_UI_DESIGN_SYSTEM_CSS,
      );

      const tool = result.current.ck.copilotkit.getTool({
        toolName: "generateSandboxedUi",
      });
      expect(tool).toBeDefined();
      expect(tool!.description!).toContain("--color-background-primary");

      const designContext = findDesignSkillContext(
        result.current.ck.copilotkit.context,
      );
      expect(designContext).toBeDefined();
      expect(designContext!.value).toContain("var(--color-");
    });
  });

  describe("(l) non-empty custom css is preserved and advertised as custom", () => {
    it('designSystem: { css: "X{}" } → designSystemCss === "X{}" and the description advertises the custom-kit line', () => {
      const { result } = renderHook(
        () => ({
          options: useOpenGenerativeUIOptions(),
          ck: useCopilotKit(),
        }),
        {
          wrapper: ({ children }) => (
            <CopilotKitProvider
              openGenerativeUI={{ designSystem: { css: "X{}" } }}
            >
              {children}
            </CopilotKitProvider>
          ),
        },
      );

      expect(result.current.options.designSystemCss).toBe("X{}");

      const tool = result.current.ck.copilotkit.getTool({
        toolName: "generateSandboxedUi",
      });
      expect(tool).toBeDefined();
      expect(tool!.description!).toContain(
        "A custom design system stylesheet is PRE-INJECTED",
      );
    });
  });

  describe("(m) resolved options stay referentially stable across re-renders with inline props", () => {
    it("a fresh inline openGenerativeUI object each render → useOpenGenerativeUIOptions() result (and importMap) is referentially equal across renders", () => {
      // The documented inline idiom creates new `openGenerativeUI`,
      // `libraries`, and `designSystem` objects on every render. The resolved
      // options must stay referentially stable so downstream consumers (the
      // live sandbox iframe) are not destroyed and rebuilt on unrelated parent
      // re-renders.
      const { result, rerender } = renderHook(
        () => useOpenGenerativeUIOptions(),
        {
          wrapper: ({ children }) => (
            <CopilotKitProvider
              openGenerativeUI={{
                libraries: { foo: "https://x" },
                designSystem: { css: "X{}" },
              }}
            >
              {children}
            </CopilotKitProvider>
          ),
        },
      );

      const first = result.current;
      const firstImportMap = result.current.importMap;

      // Re-render the wrapper, which builds a brand-new inline object literal.
      rerender();

      expect(result.current).toBe(first);
      expect(result.current.importMap).toBe(firstImportMap);
    });
  });

  describe("(n) genuine value changes are still detected", () => {
    it("rerender with a different inline libraries value → importMap identity changes and contains the new entry", () => {
      // Drive the inline value from a closure variable the wrapper reads on
      // every render, so we can change the VALUE (foo → bar) between renders
      // while still passing a fresh inline object literal each time.
      let libKey = "foo";
      const { result, rerender } = renderHook(
        () => useOpenGenerativeUIOptions(),
        {
          wrapper: ({ children }) => (
            <CopilotKitProvider
              openGenerativeUI={{ libraries: { [libKey]: "https://x" } }}
            >
              {children}
            </CopilotKitProvider>
          ),
        },
      );

      const firstImportMap = result.current.importMap as Record<string, string>;
      expect(firstImportMap).toHaveProperty("foo", "https://x");

      // Change the actual value (foo → bar); identity must change.
      libKey = "bar";
      rerender();

      expect(result.current.importMap).not.toBe(firstImportMap);
      const nextImportMap = result.current.importMap as Record<string, string>;
      expect(nextImportMap).toHaveProperty("bar", "https://x");
      expect(nextImportMap).not.toHaveProperty("foo");
    });
  });
});
