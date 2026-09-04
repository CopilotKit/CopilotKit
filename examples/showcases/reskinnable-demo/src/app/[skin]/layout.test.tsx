import { Suspense, useEffect, useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The per-skin layout hands `CopilotKitProvider` its array props directly. The
 * SDK compares each of them BY REFERENCE against the value it saw on the first
 * render and `console.error`s when it changes — unconditionally, with no
 * NODE_ENV gate — because a changing array means dynamically added/removed
 * tools, which it cannot support. A fresh `?? []` literal in the layout's JSX
 * therefore trips that check on EVERY render after the first, for every skin
 * that omits the prop (airline and bookstore omit `sandboxFunctions`).
 *
 * These tests mount the real layout against a stand-in provider that replays
 * that exact check, so the assertion is the user-visible symptom (a console
 * error storm) and not a restatement of the implementation.
 */

const { providerProps } = vi.hoisted(() => ({
  providerProps: [] as Record<string, unknown>[],
}));

/** Faithful replica of the SDK's `useStableArrayProp` guard. */
function useStableArrayProp(prop: unknown, warningMessage: string) {
  const initial = useRef(prop);
  useEffect(() => {
    if (prop !== initial.current) console.error(warningMessage);
  }, [prop, warningMessage]);
}

// Partial mock: sibling shell modules pull plenty of other exports from this
// package at import time, so keep the real namespace and swap only the provider.
vi.mock("@copilotkit/react-core/v2", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CopilotKitProvider: (props: Record<string, unknown>) => {
    providerProps.push(props);
    const openGenerativeUI = props.openGenerativeUI as
      | { sandboxFunctions?: unknown }
      | undefined;
    useStableArrayProp(
      openGenerativeUI?.sandboxFunctions,
      "openGenerativeUI.sandboxFunctions must be a stable array.",
    );
    useStableArrayProp(
      props.renderActivityMessages,
      "renderActivityMessages must be a stable array.",
    );
    useStableArrayProp(
      props.renderToolCalls,
      "renderToolCalls must be a stable array.",
    );
    // Renders nothing: this suite is about the props the layout computes, so
    // the whole chat/canvas subtree below the provider stays unmounted.
    return null;
  },
  useConfigureSuggestions: () => {},
}));

// A skin shaped like airline/bookstore: no `sandboxFunctions`, no
// `RuntimeProviders`, no `useRuntimeProperties` — the arms that use `?? []`.
const skin = {
  id: "airline",
  identity: { favicon: "✈️" },
  themeClass: "theme-airline",
  Layout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tools: () => null,
  catalog: {},
  suggestions: [],
  designSkill: "brief",
};

vi.mock("@/shell/registry", () => ({ getSkin: () => skin }));

const params = Promise.resolve({ skin: "airline" });

const sandboxFunctionsOf = (props: Record<string, unknown>) =>
  (props.openGenerativeUI as { sandboxFunctions?: unknown })?.sandboxFunctions;

async function mountLayout() {
  const { default: SkinLayout } = await import("./layout");
  const tree = () => (
    <Suspense fallback={null}>
      <SkinLayout params={params}>{null}</SkinLayout>
    </Suspense>
  );
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(tree());
  });
  return {
    rerender: async () => {
      await act(async () => {
        view.rerender(tree());
      });
    },
  };
}

afterEach(() => {
  cleanup();
  providerProps.length = 0;
  vi.restoreAllMocks();
});

describe("SkinLayout provider props", () => {
  it("does not churn CopilotKitProvider's array props across renders", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = await mountLayout();
    await view.rerender();
    await view.rerender();

    expect(providerProps.length).toBeGreaterThan(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps sandboxFunctions referentially stable for a skin that has none", async () => {
    const view = await mountLayout();
    await view.rerender();

    const [first, ...rest] = providerProps.map(sandboxFunctionsOf);
    expect(rest.length).toBeGreaterThan(0);
    for (const next of rest) expect(next).toBe(first);
  });
});
