import { Suspense, useEffect, useMemo, useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The per-skin layout hands `CopilotKitProvider` two memoized config objects
 * (`a2ui`, `openGenerativeUI`) plus two module-level renderer arrays. The SDK
 * guards the ARRAY-shaped props with `useStableArrayProp`: it compares each
 * against the value it saw on the first render and `console.error`s on a
 * change — no NODE_ENV gate — because a changing array means dynamically
 * added/removed tools it cannot support.
 *
 * Two details of that guard decide whether a given change is reported at all,
 * so the replica below reproduces them instead of paraphrasing:
 *
 *   - a nullish prop is replaced by ONE stable `[]` (`prop ?? empty`), so
 *     passing `undefined` never trips the check — only a fresh literal does;
 *   - `renderToolCalls` is given an `isMeaningfulChange` comparator, so a new
 *     array carrying the same `agentId:name` set is deliberately NOT reported.
 *
 * A replica missing either over-reports: it fails benign refactors the real SDK
 * tolerates, and it credits the layout for stability the SDK never asked of it.
 *
 * These tests mount the REAL layout against a stand-in provider replaying that
 * guard, so the array assertions are the user-visible symptom (a console error
 * storm) rather than a restatement of the implementation. The console check has
 * no reach over the two memoized OBJECTS, though — see the last test for why,
 * and for the mutant it exists to catch.
 */

const { providerProps } = vi.hoisted(() => ({
  providerProps: [] as Record<string, unknown>[],
}));

/**
 * The SDK's own `renderToolCalls` comparator, transcribed from the installed
 * `@copilotkit/react-core` dist bundle. Module-level so it is referentially
 * stable, matching the inline literal's behaviour in the SDK's effect deps.
 */
function toolCallKey(rc: unknown) {
  const { agentId, name } = (rc ?? {}) as { agentId?: string; name?: string };
  return `${agentId ?? ""}:${name ?? ""}`;
}

function toolCallKeySet(arr: unknown) {
  return new Set((arr as unknown[]).map(toolCallKey));
}

function renderToolCallsChanged(initial: unknown, next: unknown) {
  // The SDK declares the two helpers above inline inside this comparator; they
  // are hoisted here only to satisfy `unicorn/consistent-function-scoping`.
  const a = toolCallKeySet(initial);
  const b = toolCallKeySet(next);
  if (a.size !== b.size) return true;
  for (const k of a) if (!b.has(k)) return true;
  return false;
}

/**
 * Replica of the SDK's `useStableArrayProp`, transcribed from the installed
 * `@copilotkit/react-core` dist bundle rather than reconstructed from memory —
 * `?? empty` substitution and optional comparator included.
 */
function useStableArrayProp(
  prop: unknown,
  warningMessage: string,
  isMeaningfulChange?: (initial: unknown, next: unknown) => boolean,
) {
  const empty = useMemo(() => [], []);
  const value = prop ?? empty;
  const initial = useRef(value);
  useEffect(() => {
    if (
      value !== initial.current &&
      (isMeaningfulChange ? isMeaningfulChange(initial.current, value) : true)
    )
      console.error(warningMessage);
  }, [value, warningMessage, isMeaningfulChange]);
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
      renderToolCallsChanged,
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

// `allSkins` is mocked alongside `getSkin` because `layout.tsx` reaches the
// registry twice: directly for `getSkin`, and transitively through
// `ShellFrame` → `selector-card`, which imports `allSkins` at module scope and
// calls it while rendering. The stand-in provider above returns null so that
// subtree stays unmounted today, which is the only reason a `getSkin`-only mock
// survived — the mock should describe the module, not the current render depth.
vi.mock("@/shell/registry", () => ({
  getSkin: () => skin,
  allSkins: () => [skin],
}));

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

    // Pinned exactly, not `> 1`: the whole suite is worthless if the provider
    // stops re-rendering, and a lower bound cannot tell "re-rendered twice" from
    // "re-rendered once and the second rerender was a no-op". One mount plus two
    // rerenders is three provider renders; change this only alongside the calls
    // above.
    expect(providerProps).toHaveLength(3);
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps sandboxFunctions referentially stable for a skin that has none", async () => {
    const view = await mountLayout();
    await view.rerender();

    const [first, ...rest] = providerProps.map(sandboxFunctionsOf);
    expect(rest.length).toBeGreaterThan(0);
    for (const next of rest) expect(next).toBe(first);
  });

  it("keeps the memoized `a2ui` and `openGenerativeUI` objects referentially stable", async () => {
    const view = await mountLayout();
    await view.rerender();
    await view.rerender();

    // These two are OBJECT props, and the SDK's array guard cannot see them: it
    // reads `openGenerativeUI?.sandboxFunctions`, which stays
    // `NO_SANDBOX_FUNCTIONS` no matter how often the wrapper object is rebuilt,
    // and it never looks at `a2ui` at all. The provider instead keys internal
    // memos off `a2ui` BY IDENTITY (rebuilding its activity-renderer list on
    // every change), so a churning wrapper is real wasted work with no console
    // trace — and, in this suite, no failing assertion either until now:
    // deleting either `useMemo` in `layout.tsx` left the two tests above green.
    //
    // Honest note on the layout comment above `NO_SANDBOX_FUNCTIONS`: swapping
    // that constant for an inline `?? []` does NOT on its own produce the error
    // storm it describes, because the surrounding `useMemo` never re-runs (its
    // deps are `skin.sandboxFunctions` and `skin.designSkill`, both fixed for
    // the subtree's keyed lifetime). The storm needs BOTH mutations — inline
    // `?? []` AND no memo. The two are guarded separately: the memo by this
    // test, the `?? []` by the previous one once the memo is gone.
    const identities = providerProps.map((p) => ({
      a2ui: p.a2ui,
      openGenerativeUI: p.openGenerativeUI,
    }));
    const [first, ...rest] = identities;
    expect(rest.length).toBeGreaterThan(0);
    for (const next of rest) {
      expect(next.a2ui).toBe(first.a2ui);
      expect(next.openGenerativeUI).toBe(first.openGenerativeUI);
    }
  });
});
