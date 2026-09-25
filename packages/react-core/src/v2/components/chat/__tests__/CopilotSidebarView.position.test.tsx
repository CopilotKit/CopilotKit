import React from "react";
import { act, render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CopilotSidebarView } from "../CopilotSidebarView";
import { CopilotSidebar } from "../CopilotSidebar";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../../__tests__/utils/test-helpers";

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      {children}
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const sampleMessages = [{ id: "1", role: "user" as const, content: "Hello" }];

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
      expect(aside.classList.contains("cpk:right-0")).toBe(true);
      expect(aside.classList.contains("cpk:border-l")).toBe(true);
      expect(aside.classList.contains("cpk:left-0")).toBe(false);
      expect(aside.classList.contains("cpk:border-r")).toBe(false);
    });

    it('renders right-anchored when position="right" explicitly', () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView messages={sampleMessages} position="right" />
        </TestWrapper>,
      );

      const aside = getSidebarAside(container);
      expect(aside.classList.contains("cpk:right-0")).toBe(true);
      expect(aside.classList.contains("cpk:border-l")).toBe(true);
      expect(aside.classList.contains("cpk:left-0")).toBe(false);
      expect(aside.classList.contains("cpk:border-r")).toBe(false);
    });

    it('renders left-anchored when position="left"', () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView messages={sampleMessages} position="left" />
        </TestWrapper>,
      );

      const aside = getSidebarAside(container);
      expect(aside.classList.contains("cpk:left-0")).toBe(true);
      expect(aside.classList.contains("cpk:border-r")).toBe(true);
      expect(aside.classList.contains("cpk:right-0")).toBe(false);
      expect(aside.classList.contains("cpk:border-l")).toBe(false);
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
      expect(aside.classList.contains("cpk:translate-x-full")).toBe(true);
      expect(aside.classList.contains("cpk:-translate-x-full")).toBe(false);
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
      expect(aside.classList.contains("cpk:-translate-x-full")).toBe(true);
      expect(aside.classList.contains("cpk:translate-x-full")).toBe(false);
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
      expect(toggle.classList.contains("cpk:left-6")).toBe(true);
      expect(toggle.classList.contains("cpk:right-auto")).toBe(true);
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
      expect(toggle.classList.contains("cpk:right-6")).toBe(true);
      expect(toggle.classList.contains("cpk:left-6")).toBe(false);
    });

    it("clears desktop body docking when the viewport becomes mobile", () => {
      let isDesktop = true;
      const listeners = new Set<() => void>();
      const desktopQuery = {
        get matches() {
          return isDesktop;
        },
        addEventListener: (_type: string, listener: () => void) =>
          listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) =>
          listeners.delete(listener),
      } as unknown as MediaQueryList;
      const originalMatchMedia = window.matchMedia;
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => desktopQuery,
      });

      try {
        const { unmount } = render(
          <TestWrapper>
            <CopilotSidebarView messages={sampleMessages} width={480} />
          </TestWrapper>,
        );
        expect(document.body.style.marginInlineEnd).toBe("480px");

        act(() => {
          isDesktop = false;
          listeners.forEach((listener) => listener());
        });
        expect(document.body.style.marginInlineEnd).toBe("");

        act(() => {
          isDesktop = true;
          listeners.forEach((listener) => listener());
        });
        expect(document.body.style.marginInlineEnd).toBe("480px");
        unmount();
        expect(document.body.style.marginInlineEnd).toBe("");
      } finally {
        Object.defineProperty(window, "matchMedia", {
          configurable: true,
          value: originalMatchMedia,
        });
      }
    });
  });

  describe("CopilotSidebar wrapper", () => {
    it('forwards position="left" through to CopilotSidebarView', () => {
      const { container } = renderWithCopilotKit({
        agent: new MockStepwiseAgent(),
        children: <CopilotSidebar position="left" />,
      });

      const aside = getSidebarAside(container);
      expect(aside.classList.contains("cpk:left-0")).toBe(true);
      expect(aside.classList.contains("cpk:border-r")).toBe(true);
    });

    it("defaults to right-anchored when position is omitted", () => {
      const { container } = renderWithCopilotKit({
        agent: new MockStepwiseAgent(),
        children: <CopilotSidebar />,
      });

      const aside = getSidebarAside(container);
      expect(aside.classList.contains("cpk:right-0")).toBe(true);
      expect(aside.classList.contains("cpk:border-l")).toBe(true);
    });
  });
});
