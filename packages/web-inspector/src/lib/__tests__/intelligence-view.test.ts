import { expect, test } from "vitest";
import { CopilotKitCore } from "@copilotkit/core";
import { InspectorIntelligenceView } from "../../components/intelligence-view.js";

test("embeds only the content pane without adding a launcher, dialog or navigation shell", async () => {
  const view = new InspectorIntelligenceView();
  view.appUrl = "https://intelligence.example/inspector.html";
  view.core = new CopilotKitCore({
    runtimeUrl: "https://customer.example/copilot",
  });
  view.section = "governance";
  view.agentId = "support";
  document.body.append(view);
  try {
    await view.updateComplete;
    const frame = view.shadowRoot?.querySelector("iframe");
    expect(frame).not.toBeNull();
    const url = new URL(frame!.src);
    expect(url.searchParams.get("section")).toBe("governance");
    expect(url.searchParams.get("agentId")).toBe("support");
    expect([...url.searchParams.keys()]).toEqual([
      "parentOrigin",
      "section",
      "agentId",
    ]);
    expect(view.shadowRoot?.querySelector("dialog,nav,button")).toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-forms allow-downloads",
    );
  } finally {
    view.remove();
  }
});

test("does not embed credential-bearing or insecure remote app URLs", async () => {
  const view = new InspectorIntelligenceView();
  view.core = new CopilotKitCore({
    runtimeUrl: "https://customer.example/copilot",
  });
  view.appUrl = "https://user:secret@intelligence.example/inspector.html";
  document.body.append(view);
  try {
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector("iframe")).toBeNull();
    view.appUrl = "http://intelligence.example/inspector.html";
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector("iframe")).toBeNull();
  } finally {
    view.remove();
  }
});
