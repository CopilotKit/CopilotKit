import React from "react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { Catalog } from "@copilotkit/a2ui-renderer";
import { CopilotKitCore } from "@copilotkit/core";
import type { CopilotKitCoreReact } from "../../lib/react-core";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import { useA2UIMarkdownConfig } from "../../a2ui/markdown";
import type { A2UIMarkdownConfig } from "../../a2ui/markdown";

let capturedCore: CopilotKitCoreReact | null = null;
function CoreCapture() {
  const { copilotkit } = useCopilotKit();
  capturedCore = copilotkit;
  return null;
}

function Probe({
  onConfig,
}: {
  onConfig: (c: A2UIMarkdownConfig | null) => void;
}) {
  onConfig(useA2UIMarkdownConfig());
  return null;
}

describe("CopilotKitProvider a2ui markdown mode", () => {
  beforeEach(() => {
    capturedCore = null;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards __copilotkitA2UIMode and not a2uiCatalogAvailable", () => {
    render(
      <CopilotKitProvider a2ui={{ mode: "markdown" }}>
        <CoreCapture />
      </CopilotKitProvider>,
    );
    const props = capturedCore!.properties;
    expect(props.__copilotkitA2UIMode).toBe("markdown");
    expect(props.a2uiCatalogAvailable).toBeUndefined();
  });

  it("uses a user catalog in place of the standard one and still does not forward a2uiCatalogAvailable", () => {
    const userCatalog = new Catalog("copilotkit://user-catalog", [], []);
    let cfg: A2UIMarkdownConfig | null = null;
    render(
      <CopilotKitProvider a2ui={{ mode: "markdown", catalog: userCatalog }}>
        <CoreCapture />
        <Probe onConfig={(c) => (cfg = c)} />
      </CopilotKitProvider>,
    );
    const props = capturedCore!.properties;
    expect(props.__copilotkitA2UIMode).toBe("markdown");
    expect(props.a2uiCatalogAvailable).toBeUndefined();
    expect(cfg!.catalogId).toBe("copilotkit://user-catalog");
    expect(cfg!.catalog.components.has("Box")).toBe(false);
  });

  it("sends the markdown guideline instead of the tool guideline", () => {
    // Record addContext calls directly: the global test setup mocks
    // `randomUUID` to a constant, so entries overwrite each other in the store.
    const addContext = vi.spyOn(CopilotKitCore.prototype, "addContext");
    render(
      <CopilotKitProvider a2ui={{ mode: "markdown" }}>
        <CoreCapture />
      </CopilotKitProvider>,
    );
    const entries = addContext.mock.calls.map(([ctx]) => ctx);
    expect(entries.some((c) => c.description.includes("markdown-mode"))).toBe(
      true,
    );
    expect(entries.some((c) => c.value.includes("render_a2ui"))).toBe(false);
  });

  it("still sends the markdown guideline when includeSchema is false", () => {
    const addContext = vi.spyOn(CopilotKitCore.prototype, "addContext");
    render(
      <CopilotKitProvider a2ui={{ mode: "markdown", includeSchema: false }}>
        <CoreCapture />
      </CopilotKitProvider>,
    );
    const entries = addContext.mock.calls.map(([ctx]) => ctx);
    expect(entries.some((c) => c.description.includes("markdown-mode"))).toBe(
      true,
    );
    expect(
      entries.some((c) => c.description.includes("A2UI Component Schema")),
    ).toBe(false);
  });

  it("provides the standard catalog by default in markdown mode", () => {
    let cfg: A2UIMarkdownConfig | null = null;
    render(
      <CopilotKitProvider a2ui={{ mode: "markdown" }}>
        <Probe onConfig={(c) => (cfg = c)} />
      </CopilotKitProvider>,
    );
    expect(cfg).not.toBeNull();
    expect(cfg!.catalog.components.has("Box")).toBe(true);
    expect(cfg!.catalogId).toBe(cfg!.catalog.id);
    expect(cfg!.actionMode).toBe("message");
  });

  it("passes onAction and actionMode through to the markdown config", () => {
    const onAction = () => undefined;
    let cfg: A2UIMarkdownConfig | null = null;
    render(
      <CopilotKitProvider
        a2ui={{ mode: "markdown", onAction, actionMode: "legacy" }}
      >
        <Probe onConfig={(c) => (cfg = c)} />
      </CopilotKitProvider>,
    );
    expect(cfg!.onAction).toBe(onAction);
    expect(cfg!.actionMode).toBe("legacy");
  });

  it("does not register the a2ui-surface activity renderer in markdown mode", () => {
    render(
      <CopilotKitProvider a2ui={{ mode: "markdown" }}>
        <CoreCapture />
      </CopilotKitProvider>,
    );
    expect(
      capturedCore!.renderActivityMessages.some(
        (r) => r.activityType === "a2ui-surface",
      ),
    ).toBe(false);
  });

  it("keeps tool mode behaviour when mode is omitted", () => {
    let cfg: A2UIMarkdownConfig | null | "unset" = "unset";
    render(
      <CopilotKitProvider a2ui={{ catalog: undefined }}>
        <Probe onConfig={(c) => (cfg = c)} />
        <CoreCapture />
      </CopilotKitProvider>,
    );
    expect(cfg).toBeNull();
    expect(capturedCore!.properties.__copilotkitA2UIMode).toBeUndefined();
  });
});
