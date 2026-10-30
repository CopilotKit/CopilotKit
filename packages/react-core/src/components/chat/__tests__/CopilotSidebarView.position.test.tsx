import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CopilotSidebarView } from "../CopilotSidebarView";
import { CopilotSidebar } from "../CopilotSidebar";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../../__tests__/utils/test-helpers";
import { stylesheet } from "@copilotkit/core/styles";

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      {children}
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const sampleMessages = [{ id: "1", role: "user" as const, content: "Hello" }];

/** Declarations of the stylesheet's `:where(<selector>)` rule, outside media queries. */
function cssRule(selector: string): string {
  const start = stylesheet.indexOf(`}:where(${selector}){`);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  const body = stylesheet.indexOf("{", start + 1) + 1;
  return stylesheet.slice(body, stylesheet.indexOf("}", body));
}

function getSidebarAside(container: HTMLElement) {
  const sidebar = container.querySelector("[data-copilot-sidebar]");
  if (!sidebar) throw new Error("sidebar aside not found");
  return sidebar;
}

describe("CopilotSidebarView position prop", () => {
  describe("CopilotSidebarView", () => {
    it("defaults to right-anchored when position is omitted", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView messages={sampleMessages} />
        </TestWrapper>,
      );

      const aside = getSidebarAside(container);
      expect(aside.classList.contains("cpk-sidebar-view")).toBe(true);
      expect(aside.getAttribute("data-position")).toBe("right");
    });

    it('renders right-anchored when position="right" explicitly', () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView messages={sampleMessages} position="right" />
        </TestWrapper>,
      );

      const aside = getSidebarAside(container);
      expect(aside.classList.contains("cpk-sidebar-view")).toBe(true);
      expect(aside.getAttribute("data-position")).toBe("right");
    });

    it('renders left-anchored when position="left"', () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView messages={sampleMessages} position="left" />
        </TestWrapper>,
      );

      const aside = getSidebarAside(container);
      expect(aside.classList.contains("cpk-sidebar-view")).toBe(true);
      expect(aside.getAttribute("data-position")).toBe("left");
    });

    it('translates off-screen to the right when closed and position="right"', () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView
            messages={sampleMessages}
            defaultOpen={false}
            position="right"
          />
        </TestWrapper>,
      );

      const aside = getSidebarAside(container);
      expect(aside.classList.contains("cpk-sidebar-view-closed")).toBe(true);
      expect(aside.getAttribute("data-position")).toBe("right");
    });

    it('translates off-screen to the left when closed and position="left"', () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView
            messages={sampleMessages}
            defaultOpen={false}
            position="left"
          />
        </TestWrapper>,
      );

      const aside = getSidebarAside(container);
      expect(aside.classList.contains("cpk-sidebar-view-closed")).toBe(true);
      expect(aside.getAttribute("data-position")).toBe("left");
    });

    it('anchors the toggle button to the left when position="left"', () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView messages={sampleMessages} position="left" />
        </TestWrapper>,
      );

      const toggle = container.querySelector(
        '[data-slot="chat-toggle-button"]',
      );
      if (!toggle) throw new Error("toggle button not found");
      expect(
        toggle.classList.contains("cpk-sidebar-view-toggle-button-left"),
      ).toBe(true);
    });

    it("keeps the toggle button right-anchored by default", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView messages={sampleMessages} />
        </TestWrapper>,
      );

      const toggle = container.querySelector(
        '[data-slot="chat-toggle-button"]',
      );
      if (!toggle) throw new Error("toggle button not found");
      expect(toggle.classList.contains("cpk-chat-toggle-button")).toBe(true);
      expect(
        toggle.classList.contains("cpk-sidebar-view-toggle-button-left"),
      ).toBe(false);
    });
  });

  // jsdom does no layout, so these pin the rules the classes above rely on.
  describe("stylesheet", () => {
    it("docks right by default and left for data-position=left", () => {
      expect(cssRule(".cpk-sidebar-view")).toContain("right:0;");
      expect(cssRule(".cpk-sidebar-view")).toContain(
        "border-left:1px solid var(--border)",
      );
      const left = cssRule(".cpk-sidebar-view[data-position=left]");
      expect(left).toContain("right:auto;left:0");
      expect(left).toContain("border-right:1px solid var(--border)");
    });

    it("slides a closed sidebar off its own edge", () => {
      expect(cssRule(".cpk-sidebar-view-closed")).toBe(
        "pointer-events:none;translate:100% 0",
      );
      expect(cssRule(".cpk-sidebar-view-closed[data-position=left]")).toBe(
        "translate:-100% 0",
      );
    });

    it("moves the toggle button to the left edge", () => {
      expect(cssRule(".cpk-sidebar-view-toggle-button-left")).toBe(
        "right:auto;left:1.5rem",
      );
    });
  });

  describe("CopilotSidebar wrapper", () => {
    it('forwards position="left" through to CopilotSidebarView', () => {
      const { container } = renderWithCopilotKit({
        agent: new MockStepwiseAgent(),
        children: <CopilotSidebar position="left" />,
      });

      const aside = getSidebarAside(container);
      expect(aside.getAttribute("data-position")).toBe("left");
    });

    it("defaults to right-anchored when position is omitted", () => {
      const { container } = renderWithCopilotKit({
        agent: new MockStepwiseAgent(),
        children: <CopilotSidebar />,
      });

      const aside = getSidebarAside(container);
      expect(aside.getAttribute("data-position")).toBe("right");
    });
  });
});
