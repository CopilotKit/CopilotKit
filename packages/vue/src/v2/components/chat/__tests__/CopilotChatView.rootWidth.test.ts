import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatView from "../CopilotChatView.vue";

const CHAT_ROOT_SELECTOR = ".copilotKitChat[data-copilotkit]";

// Resolve from this file, so the read does not depend on the working directory.
// (A `new URL(...)` object fails here: under jsdom it is not Node's URL.)
const globalsCss = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../styles/globals.css",
  ),
  { encoding: "utf8" },
);

/** Returns the body of the first `@layer <name> { ... }` block. */
function layerBody(css: string, name: string): string {
  const start = css.indexOf(`@layer ${name} {`);
  if (start === -1) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) {
      return css.slice(css.indexOf("{", start) + 1, i);
    }
  }
  return "";
}

function mountChatView(props: Record<string, unknown>) {
  return mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit" },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { threadId: "t1" },
          { default: () => h(CopilotChatView, props) },
        ),
    },
  });
}

// PE-1053, the Vue side of PE-788: the chat root is an inline-size container
// (`cpk:@container`), so its content gives it no intrinsic width. As a flex
// item in a row its auto width collapsed to a narrow column. jsdom does no
// layout, so these tests pin the two halves of the fix: the base-layer width
// rule, and a chat root that the rule's selector matches.
describe("CopilotChatView root width (PE-1053)", () => {
  it("fills its container from the base layer, so app widths still win", () => {
    const base = layerBody(globalsCss, "base").replace(/\s+/g, " ");
    expect(base).toContain(`${CHAT_ROOT_SELECTOR} { width: 100%; }`);
  });

  // The welcome screen and the message view share this one root element.
  it("the chat root matches the width rule", () => {
    const wrapper = mountChatView({ messages: [] });
    const root = wrapper.find("[data-testid='copilot-chat-view']");
    expect(root.exists()).toBe(true);
    expect(root.element.matches(CHAT_ROOT_SELECTOR)).toBe(true);
  });
});
