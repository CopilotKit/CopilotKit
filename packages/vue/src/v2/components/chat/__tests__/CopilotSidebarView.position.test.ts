import { describe, expect, it } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import type { Message } from "@ag-ui/core";
import { stylesheet } from "@copilotkit/core/styles";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import CopilotSidebar from "../CopilotSidebar.vue";
import { CopilotSidebarView } from "../index";

// Ported from react-core's CopilotSidebarView.position.test.tsx.

const sampleMessages: Message[] = [
  { id: "1", role: "user", content: "Hello", timestamp: new Date() } as Message,
];

/** Declarations of the stylesheet's `:where(<selector>)` rule, outside media queries. */
function cssRule(selector: string): string {
  const start = stylesheet.indexOf(`}:where(${selector}){`);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  const body = stylesheet.indexOf("{", start + 1) + 1;
  return stylesheet.slice(body, stylesheet.indexOf("}", body));
}

function mountSidebarView(props: Record<string, unknown> = {}) {
  return mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit" },
    slots: {
      default: () =>
        h(CopilotSidebarView, { messages: sampleMessages, ...props }),
    },
  });
}

function mountSidebar(props: Record<string, unknown> = {}) {
  return mount(CopilotKitProvider, {
    props: { agents__unsafe_dev_only: { default: new StateCapturingAgent() } },
    slots: { default: () => h(CopilotSidebar, props) },
  });
}

describe("CopilotSidebarView position prop", () => {
  describe("CopilotSidebarView", () => {
    it("defaults to right-anchored when position is omitted", () => {
      const aside = mountSidebarView().get("[data-copilot-sidebar]");
      expect(aside.classes()).toContain("cpk-sidebar-view");
      expect(aside.attributes("data-position")).toBe("right");
    });

    it('renders right-anchored when position="right" explicitly', () => {
      const aside = mountSidebarView({ position: "right" }).get(
        "[data-copilot-sidebar]",
      );
      expect(aside.attributes("data-position")).toBe("right");
    });

    it('renders left-anchored when position="left"', () => {
      const aside = mountSidebarView({ position: "left" }).get(
        "[data-copilot-sidebar]",
      );
      expect(aside.classes()).toContain("cpk-sidebar-view");
      expect(aside.attributes("data-position")).toBe("left");
    });

    it('slides off to the left when closed and position="left"', () => {
      const aside = mountSidebarView({
        position: "left",
        defaultOpen: false,
      }).get("[data-copilot-sidebar]");
      expect(aside.classes()).toContain("cpk-sidebar-view-closed");
      expect(aside.attributes("data-position")).toBe("left");
    });

    it('anchors the toggle button to the left when position="left"', () => {
      const toggle = mountSidebarView({ position: "left" }).get(
        '[data-slot="chat-toggle-button"]',
      );
      expect(toggle.classes()).toContain("cpk-sidebar-view-toggle-button-left");
    });

    it("keeps the toggle button right-anchored by default", () => {
      const toggle = mountSidebarView().get('[data-slot="chat-toggle-button"]');
      expect(toggle.classes()).toContain("cpk-chat-toggle-button");
      expect(toggle.classes()).not.toContain(
        "cpk-sidebar-view-toggle-button-left",
      );
    });

    it("makes room for the sidebar on the edge it docks to", () => {
      const left = mountSidebarView({ position: "left", width: 400 });
      expect(left.html()).toContain("margin-inline-start: 400px");
      expect(left.html()).not.toContain("margin-inline-end");

      const right = mountSidebarView({ width: 400 });
      expect(right.html()).toContain("margin-inline-end: 400px");
    });
  });

  // jsdom does no layout, so these pin the rules the attributes above rely on.
  describe("stylesheet", () => {
    it("docks left for data-position=left", () => {
      const left = cssRule(".cpk-sidebar-view[data-position=left]");
      expect(left).toContain("right:auto;left:0");
      expect(cssRule(".cpk-sidebar-view-closed[data-position=left]")).toBe(
        "translate:-100% 0",
      );
      expect(cssRule(".cpk-sidebar-view-toggle-button-left")).toBe(
        "right:auto;left:1.5rem",
      );
    });
  });

  describe("CopilotSidebar wrapper", () => {
    it('forwards position="left" through to CopilotSidebarView', () => {
      const aside = mountSidebar({ position: "left" }).get(
        "[data-copilot-sidebar]",
      );
      expect(aside.attributes("data-position")).toBe("left");
    });

    it("defaults to right-anchored when position is omitted", () => {
      const aside = mountSidebar().get("[data-copilot-sidebar]");
      expect(aside.attributes("data-position")).toBe("right");
    });
  });
});
