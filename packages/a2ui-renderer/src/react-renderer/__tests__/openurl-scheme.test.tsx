import React, { useEffect } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { A2UIProvider } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import { useA2UI } from "../hooks/useA2UI";

/**
 * Regression guard for GHSA-72qq-p3r5-f7wq.
 *
 * `@a2ui/web_core` <= 0.10.1 passed an agent-supplied `openUrl` argument
 * straight to `window.open()` with no scheme check, so a Button whose
 * `functionCall` named a `javascript:` URI executed arbitrary script in the
 * host origin on click. We pin the patched web_core; these tests fail loudly
 * if that pin is ever rolled back, since the vulnerable sink lives in a
 * transitive dependency where a version bump alone is easy to miss.
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

function Surface({ url }: { url: string }) {
  const { processMessages } = useA2UI();
  useEffect(() => {
    processMessages(openUrlButtonOperations(url) as any);
  }, [processMessages, url]);
  return <A2UIRenderer surfaceId="surface" />;
}

/** Renders a Button bound to `openUrl(url)`, clicks it, and reports what escaped. */
async function clickOpenUrlButton(url: string) {
  const uncaught: string[] = [];
  const onError = (event: ErrorEvent) => {
    uncaught.push(String(event.error ?? event.message));
    event.preventDefault();
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    uncaught.push(String(event.reason));
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

  try {
    render(
      <A2UIProvider>
        <Surface url={url} />
      </A2UIProvider>,
    );
    await tick();

    const button = document.querySelector("button");
    expect(button).not.toBeNull();
    button!.click();
    await tick();

    return {
      openCalls: openSpy.mock.calls,
      uncaught,
      stillMounted: document.querySelector("button") !== null,
    };
  } finally {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  }
}

describe("openUrl scheme handling (React renderer)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not open a javascript: URI supplied by the agent", async () => {
    const { openCalls } = await clickOpenUrlButton("javascript:alert(1)");
    expect(openCalls).toEqual([]);
  });

  it("does not open a data: URI supplied by the agent", async () => {
    const { openCalls } = await clickOpenUrlButton(
      "data:text/html,<script>alert(1)</script>",
    );
    expect(openCalls).toEqual([]);
  });

  it("opens an https URL with noopener and noreferrer", async () => {
    const { openCalls } = await clickOpenUrlButton("https://example.com");
    expect(openCalls).toEqual([
      ["https://example.com/", "_blank", "noopener,noreferrer"],
    ]);
  });

  // A blocked scheme makes web_core throw A2uiExpressionError, which it routes
  // to the surface error channel rather than out through the click handler.
  // Assert that here so a future change that lets it escape into React's event
  // dispatch — breaking the surface on a hostile URL — is caught.
  it("keeps the surface mounted and raises nothing when a scheme is blocked", async () => {
    const { uncaught, stillMounted } = await clickOpenUrlButton(
      "javascript:alert(1)",
    );
    expect(uncaught).toEqual([]);
    expect(stillMounted).toBe(true);
  });
});
