import type { CopilotKitCore } from "@copilotkit/core";
import { WebInspectorElement } from "../../index.js";
import { requireElement } from "./test-helpers.js";

export async function mountLiveInspector(core: CopilotKitCore) {
  const inspector = new WebInspectorElement();
  inspector.core = core;
  document.body.append(inspector);
  await inspector.updateComplete;
  return inspector;
}

export async function openInspectorMenu(
  inspector: WebInspectorElement,
  menuKey: string,
): Promise<ShadowRoot> {
  const root = requireElement(
    inspector.shadowRoot,
    "The Web Inspector shadow root was not rendered.",
  );
  requireElement(
    root.querySelector<HTMLButtonElement>(
      'button[aria-label^="Web Inspector"]',
    ),
    "The Web Inspector launcher was not rendered.",
  ).click();
  await inspector.updateComplete;
  requireElement(
    root.querySelector<HTMLButtonElement>(
      `button[data-inspector-menu-key="${menuKey}"]`,
    ),
    `The ${menuKey} navigation control was not rendered.`,
  ).click();
  await inspector.updateComplete;
  return root;
}
