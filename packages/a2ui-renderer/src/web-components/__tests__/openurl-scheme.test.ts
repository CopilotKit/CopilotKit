import { afterEach, describe, expect, it, vi } from "vitest";
import { CPK_A2UI_SURFACE_TAG, defineA2UIWebComponents } from "../define";
import type { A2UISurfaceElement } from "../types";

/**
 * Regression guard for GHSA-72qq-p3r5-f7wq, mirroring the React renderer test.
 *
 * The Lit surface builds its own catalog from `BASIC_FUNCTIONS`, so it reaches
 * the vulnerable `openUrl` sink independently of the React path and needs its
 * own coverage.
 */

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function openUrlButtonOperations(url: string) {
  return [
    {
      version: "v0.9",
      createSurface: { surfaceId: "surface", catalogId: BASIC_CATALOG_ID },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "surface",
        components: [
          {
            id: "root",
            component: "Button",
            child: "label",
            action: {
              functionCall: {
                call: "openUrl",
                args: { url },
                returnType: "void",
              },
            },
            variant: "primary",
          },
          { id: "label", component: "Text", text: "Open" },
        ],
      },
    },
  ];
}

async function clickOpenUrlButton(url: string) {
  const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

  defineA2UIWebComponents();
  const element = document.createElement(
    CPK_A2UI_SURFACE_TAG,
  ) as A2UISurfaceElement;
  document.body.appendChild(element);
  element.operations = openUrlButtonOperations(url) as any;

  await (element as any).updateComplete;
  await tick();
  await tick();

  const button = element.querySelector("button");
  expect(button).not.toBeNull();
  button!.click();
  await tick();

  return { openCalls: openSpy.mock.calls };
}

describe("openUrl scheme handling (Lit renderer)", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("does not open a javascript: URI supplied by the agent", async () => {
    const { openCalls } = await clickOpenUrlButton("javascript:alert(1)");
    expect(openCalls).toEqual([]);
  });

  it("opens an https URL with noopener and noreferrer", async () => {
    const { openCalls } = await clickOpenUrlButton("https://example.com");
    expect(openCalls).toEqual([
      ["https://example.com/", "_blank", "noopener,noreferrer"],
    ]);
  });
});
