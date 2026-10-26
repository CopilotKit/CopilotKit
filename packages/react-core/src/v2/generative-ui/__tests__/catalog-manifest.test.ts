import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createGenerativeUI } from "../catalog";
import { createGenerativeUIDispatcher } from "../dispatcher";
import { buildCatalogManifest, buildGenerativeUIManifest } from "../manifest";
import { standardUI } from "../standard";
import { GenerativeUISurfaceManager } from "../surface-manager";

describe("buildCatalogManifest", () => {
  it("equals the per-run manifest when nothing is mounted", () => {
    const runtime = {
      ui: standardUI,
      manager: new GenerativeUISurfaceManager(standardUI),
      dispatcher: createGenerativeUIDispatcher({
        getDeclared: () => standardUI.functions,
      }),
    };
    expect(buildCatalogManifest(standardUI)).toEqual(
      buildGenerativeUIManifest(runtime, undefined),
    );
    expect(buildCatalogManifest(standardUI).targets).toEqual([
      { id: "chat", kind: "chat" },
    ]);
  });

  it("leaves out a built-in the app declares, and adds the given functions, targets and surfaces", () => {
    const ui = createGenerativeUI({
      id: "test/manifest@1",
      components: {},
      functions: {
        formatCurrency: {
          description: "The app's own",
          parameters: z.object({ value: z.number() }),
        },
      },
    });
    const manifest = buildCatalogManifest(ui, {
      functions: {
        addToCart: { description: "Adds", parameters: { type: "object" } },
      },
      targets: [{ id: "sidebar", kind: "inline" }],
      surfaces: { s1: { target: "chat" } },
    });
    expect(manifest.functions.formatCurrency).toBeUndefined();
    expect(manifest.functions.addToCart.description).toBe("Adds");
    expect(manifest.functions.formatDate).toBeDefined();
    expect(manifest.targets.map((t) => t.id)).toEqual(["chat", "sidebar"]);
    expect(manifest.surfaces).toEqual({ s1: { target: "chat" } });
  });
});
