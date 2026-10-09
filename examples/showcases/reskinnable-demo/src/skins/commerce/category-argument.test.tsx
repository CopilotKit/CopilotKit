import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { z } from "zod";
import {
  CATEGORY_VOCABULARY,
  categoryParameter,
  resolveCategoryScope,
} from "./category-argument";
import * as store from "./data/store";
import { CATEGORIES } from "./data/types";
import type { Operator } from "./data/types";

/**
 * BEAT 1 — the signature visual, driven by a MODEL-SUPPLIED argument.
 *
 * `showMarginLadder`'s category was a `z.string()`, and the fallback for a value
 * that matched nothing applied to the FLOORS only. So a near-miss — "Shoes" for
 * "Footwear" — drew all five rails, filtered the products to zero, and rendered
 * a full, confident, EMPTY ladder. That is the worst available outcome for this
 * component: it looks like an answer.
 *
 * Two halves are tested, because neither is sufficient:
 *
 *  - the SCHEMA now enumerates the five categories, which is what puts them in
 *    front of the model;
 *  - the RENDER refuses an off-vocabulary value, because the schema is NOT
 *    enforced before a render runs. `useComponent` forwards
 *    `partialJSONParse(toolCall.function.arguments)` straight through
 *    (`use-render-tool-call.tsx`), and a render-only tool posts an empty tool
 *    result, so an unvalidated argument reaches the DOM and nothing is reported
 *    back. A tightened schema alone would be decorative.
 *
 * The `arriving` case is the third assertion and it is not hypothetical:
 * arguments stream, so `"F"`, `"Fo"`, `"Foot"` all reach this render on the way
 * to `"Footwear"`. A refusal there would flash red on every ladder the demo
 * draws.
 *
 * No `@testing-library/jest-dom` in this app, so assertions are plain DOM.
 */

const components = new Map<string, ComponentRegistration>();

/** Only the parts of a `useComponent` registration these tests exercise. */
interface ComponentRegistration {
  name: string;
  parameters?: z.ZodType<unknown>;
  render: (props: Record<string, unknown>) => ReactNode;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/commerce",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: () => {},
  useComponent: (registration: ComponentRegistration) => {
    components.set(registration.name, registration);
  },
  useFrontendTool: () => {},
  useHumanInTheLoop: () => {},
}));

vi.mock("@/shell/skin-provider", () => ({
  useSkin: () => ({ id: "commerce" }),
}));

vi.mock("./data/ledger-context", async () => {
  const real = await import("./data/store");
  return {
    useCommerceLedger: () => ({
      data: real.snapshot(),
      refresh: async () => true,
      operator: real.operators()[0] satisfies Operator,
      setOperatorId: () => {},
    }),
  };
});

// Imported after the mocks so the module graph picks them up.
const { CommerceTools } = await import("./tools");

function ladder(): ComponentRegistration {
  const registration = components.get("showMarginLadder");
  if (!registration) throw new Error("showMarginLadder was not registered");
  return registration;
}

/** Render the ladder component exactly as a tool call would, and read the DOM. */
function renderLadder(args: Record<string, unknown>) {
  const Ladder = ladder().render;
  render(<>{Ladder(args)}</>);
  const figure = document.querySelector("figure");
  return {
    /** The ladder itself — `MarginLadder` roots at a `<figure>`. */
    figure,
    /** One button per plotted product. */
    dots: document.querySelectorAll("figure button").length,
    /**
     * Which rails are drawn. Read off the rendered text rather than a class
     * name: a rail is labelled with its category and nothing else in the ladder
     * names one, so this stays true through any styling change.
     */
    rails: CATEGORIES.filter((category) =>
      (figure?.textContent ?? "").includes(category),
    ),
    text: document.body.textContent ?? "",
  };
}

beforeEach(() => {
  store.reset();
  components.clear();
  render(<CommerceTools />);
});

afterEach(() => {
  cleanup();
});

describe("the advertised category vocabulary", () => {
  it("enumerates the five real categories rather than accepting any string", () => {
    const parameters = ladder().parameters;
    if (!parameters) throw new Error("showMarginLadder declared no parameters");

    for (const category of CATEGORIES) {
      expect(parameters.safeParse({ category }).success, category).toBe(true);
    }
    // Omitted is still legal — that is the whole range.
    expect(parameters.safeParse({}).success).toBe(true);
    // And a near-miss is a validation error, not a blank view.
    for (const bogus of ["Shoes", "footware", "Apparel", ""]) {
      expect(parameters.safeParse({ category: bogus }).success, bogus).toBe(
        false,
      );
    }
  });

  it("names the accepted values in the description the model reads", () => {
    expect(categoryParameter.description).toContain("Footwear");
    for (const category of CATEGORIES) {
      expect(CATEGORY_VOCABULARY).toContain(category);
    }
  });
});

describe("an off-vocabulary category", () => {
  it("does not render a confident empty ladder", () => {
    const { figure, dots } = renderLadder({ category: "Shoes" });

    // The finding itself: no ladder at all, rather than five rails and no dots.
    expect(figure).toBeNull();
    expect(dots).toBe(0);
  });

  it("says the category is unknown and lists the real ones", () => {
    const { text } = renderLadder({ category: "Shoes" });

    expect(text).toContain("Shoes");
    expect(text).toMatch(/no “Shoes” category/);
    for (const category of CATEGORIES) {
      expect(text, category).toContain(category);
    }
  });

  it("quotes a non-string argument back without laundering it into words", () => {
    const { figure, text } = renderLadder({ category: { name: "Footwear" } });

    expect(figure).toBeNull();
    expect(text).not.toContain("[object Object]");
  });
});

describe("every legitimate category still renders", () => {
  it.each([...CATEGORIES])("plots %s on its own rail", (category) => {
    const { figure, dots, rails } = renderLadder({ category });

    expect(figure).not.toBeNull();
    // One rail, its own, with real products on it.
    expect(rails).toEqual([category]);
    expect(dots).toBeGreaterThan(0);
  });

  it("accepts the same name in the wrong case rather than blanking", () => {
    const { figure, rails } = renderLadder({ category: "  footwear " });

    expect(figure).not.toBeNull();
    expect(rails).toEqual(["Footwear"]);
  });

  it("draws every rail when no category was asked for", () => {
    const { figure, rails, dots } = renderLadder({});

    expect(figure).not.toBeNull();
    expect(rails).toEqual([...CATEGORIES]);
    expect(dots).toBe(store.snapshot().products.length);
  });

  it("draws the whole range while the argument is still streaming", () => {
    // `partialJSONParse` hands the render every prefix of the value. A refusal
    // here would flash red on every categorised ladder in the demo.
    for (const prefix of ["F", "Fo", "Foot", "Knit"]) {
      const { figure, dots } = renderLadder({ category: prefix });
      expect(figure, prefix).not.toBeNull();
      expect(dots, prefix).toBeGreaterThan(0);
      cleanup();
    }
  });
});

describe("resolveCategoryScope", () => {
  it("reports an absent or blank category as the whole range", () => {
    expect(resolveCategoryScope(undefined)).toEqual({ kind: "all" });
    expect(resolveCategoryScope(null)).toEqual({ kind: "all" });
    expect(resolveCategoryScope("")).toEqual({ kind: "all" });
    expect(resolveCategoryScope("   ")).toEqual({ kind: "all" });
  });

  it("canonicalizes every real category", () => {
    for (const category of CATEGORIES) {
      expect(resolveCategoryScope(category)).toEqual({ kind: "one", category });
      expect(resolveCategoryScope(` ${category.toUpperCase()} `)).toEqual({
        kind: "one",
        category,
      });
    }
  });

  it("separates a streaming prefix from a value that is simply wrong", () => {
    expect(resolveCategoryScope("Foot")).toEqual({
      kind: "arriving",
      value: "Foot",
    });
    expect(resolveCategoryScope("Shoes")).toEqual({
      kind: "unknown",
      value: "Shoes",
    });
    expect(resolveCategoryScope(42)).toEqual({ kind: "unknown", value: "42" });
  });
});
