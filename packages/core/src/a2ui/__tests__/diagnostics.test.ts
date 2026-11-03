import { describe, expect, it } from "vitest";
import {
  diagnoseMissingSurface,
  diagnoseUnpaintedSurface,
  diagnoseUnresolvedRoot,
} from "../diagnostics";

function surfaceWith(ids: string[]) {
  return {
    componentsModel: { get: (id: string) => ids.includes(id) || undefined },
  };
}

const components = (ids: string[]) => ({
  version: "v0.9",
  updateComponents: {
    surfaceId: "s",
    components: ids.map((id) => ({ id, component: "Text" })),
  },
});

describe("diagnoseUnpaintedSurface", () => {
  it("returns null when the operations can paint", () => {
    expect(diagnoseUnpaintedSurface("s", [components(["root"])])).toBeNull();
  });

  it("names the missing updateComponents and the kinds that did arrive", () => {
    const message = diagnoseUnpaintedSurface("s", [
      { version: "v0.9", createSurface: { surfaceId: "s" } },
    ]);
    expect(message).toContain(
      'A2UI surface "s" received operations and never painted after 8000ms',
    );
    expect(message).toContain("no updateComponents operation arrived");
    expect(message).toContain("Operations received: createSurface.");
  });

  it("names the empty data model for path-bound components", () => {
    const message = diagnoseUnpaintedSurface("s", [
      {
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "root", component: "Text", text: { path: "/t" } }],
        },
      },
    ]);
    expect(message).toContain('address their values by "path"');
  });
});

describe("diagnoseMissingSurface", () => {
  it("counts the operations and names the surface", () => {
    expect(diagnoseMissingSurface("ghost", [components(["root"])])).toContain(
      'processed 1 operation(s) addressed to surface "ghost"',
    );
  });
});

describe("diagnoseUnresolvedRoot", () => {
  it("returns null when the root resolved", () => {
    expect(
      diagnoseUnresolvedRoot(
        "s",
        [components(["root"])],
        surfaceWith(["root"]),
      ),
    ).toBeNull();
  });

  it("returns null when no components arrived", () => {
    expect(diagnoseUnresolvedRoot("s", [], surfaceWith([]))).toBeNull();
  });

  it("names the ids that arrived when none is root", () => {
    const message = diagnoseUnresolvedRoot(
      "s",
      [components(["card", "title"])],
      surfaceWith(["card", "title"]),
    );
    expect(message).toContain(
      'are named "card", "title", and none of them is "root"',
    );
  });

  it("points at a render error when root was sent but did not reach the model", () => {
    const message = diagnoseUnresolvedRoot(
      "s",
      [components(["root"])],
      surfaceWith([]),
    );
    expect(message).toContain('a component with id "root" WAS sent');
  });
});
