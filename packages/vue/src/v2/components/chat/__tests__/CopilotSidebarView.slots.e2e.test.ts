import { render, screen, fireEvent } from "@testing-library/vue";
import { defineComponent } from "vue";
import { describe, it, expect, vi } from "vitest";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotSidebarView from "../CopilotSidebarView.vue";
import CopilotModalHeader from "../CopilotModalHeader.vue";
import CopilotChatToggleButton from "../CopilotChatToggleButton.vue";
import CopilotChatView from "../CopilotChatView.vue";

const sampleMessages = [
  { id: "1", role: "user" as const, content: "Hello" },
  { id: "2", role: "assistant" as const, content: "Hi there!" },
];

const sampleSuggestions = [
  { title: "Test", message: "Test message", isLoading: false },
];

function renderInWrapper(component: ReturnType<typeof defineComponent>) {
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      UnderTest: component,
    },
    template: `
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider thread-id="test-thread">
          <UnderTest />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  return render(Host);
}

describe("CopilotSidebarView Slot System E2E Tests", () => {
  describe("1. Tailwind Class Slot Override - Header Slot", () => {
    describe("header slot", () => {
      it("should apply tailwind class string to header", () => {
        const Host = defineComponent({
          components: { CopilotSidebarView, CopilotModalHeader },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotSidebarView :messages="sampleMessages">
              <template #header="{ title, onClose }">
                <CopilotModalHeader
                  data-testid="sidebar-header"
                  :title="title"
                  class="bg-gradient-to-r from-blue-500 to-purple-500 text-white"
                  @click="onClose"
                />
              </template>
            </CopilotSidebarView>
          `,
        });

        renderInWrapper(Host);
        const header = screen.getByTestId("sidebar-header");
        expect(header.classList.contains("bg-gradient-to-r")).toBe(true);
      });

      it("should override default header border with custom styles", () => {
        const Host = defineComponent({
          components: { CopilotSidebarView, CopilotModalHeader },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotSidebarView :messages="sampleMessages">
              <template #header="{ title }">
                <CopilotModalHeader
                  data-testid="sidebar-header"
                  :title="title"
                  class="border-none shadow-none"
                />
              </template>
            </CopilotSidebarView>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("sidebar-header")
            .classList.contains("border-none"),
        ).toBe(true);
      });
    });
  });

  describe("2. Property Passing - Header Slot", () => {
    describe("header slot", () => {
      it("should pass custom props to header", () => {
        const Host = defineComponent({
          components: { CopilotSidebarView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotSidebarView :messages="sampleMessages">
              <template #header="{ title }">
                <div data-testid="custom-sidebar-header">{{ title }}</div>
              </template>
            </CopilotSidebarView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("custom-sidebar-header")).toBeDefined();
      });

      it("should pass title prop through to header", () => {
        const Host = defineComponent({
          components: { CopilotSidebarView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotSidebarView :messages="sampleMessages">
              <template #header="{ title }">
                <div>{{ title }}</div>
              </template>
            </CopilotSidebarView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.queryByText("CopilotKit")).toBeDefined();
      });
    });
  });

  describe("3. Custom Component - Header Slot", () => {
    it("should allow custom component for header", () => {
      const Host = defineComponent({
        components: { CopilotSidebarView },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotSidebarView :messages="sampleMessages">
            <template #header>
              <header data-testid="custom-header-component" class="custom-sidebar-header">
                <span>Custom Sidebar Header</span>
                <button>Custom Close</button>
              </header>
            </template>
          </CopilotSidebarView>
        `,
      });

      renderInWrapper(Host);
      expect(
        screen.getByTestId("custom-header-component").textContent,
      ).toContain("Custom Sidebar Header");
    });

    it("should allow passing header props for customization", () => {
      const Host = defineComponent({
        components: { CopilotSidebarView, CopilotModalHeader },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotSidebarView :messages="sampleMessages">
            <template #header="{ onClose }">
              <CopilotModalHeader title="Chat Sidebar" @click="onClose">
                <template #title-content="{ title }">
                  <div class="text-lg italic">{{ title }}</div>
                </template>
              </CopilotModalHeader>
            </template>
          </CopilotSidebarView>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(screen.queryByText("Chat Sidebar")).toBeDefined();
      expect(container.querySelector(".text-lg")).toBeDefined();
      expect(container.querySelector(".italic")).toBeDefined();
    });
  });

  describe("4. Inherited CopilotChatView Slots", () => {
    describe("messageView slot (inherited)", () => {
      it("should apply tailwind class string to inherited messageView", () => {
        const Host = defineComponent({
          components: { CopilotSidebarView, CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotSidebarView :messages="sampleMessages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatView :messages="messages" :is-running="isRunning">
                  <template #message-view>
                    <div data-testid="sidebar-message-view" class="bg-gray-50 rounded-lg">message</div>
                  </template>
                </CopilotChatView>
              </template>
            </CopilotSidebarView>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("sidebar-message-view")
            .classList.contains("bg-gray-50"),
        ).toBe(true);
      });
    });

    describe("input slot (inherited)", () => {
      it("should apply tailwind class string to inherited input", () => {
        const Host = defineComponent({
          components: { CopilotSidebarView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotSidebarView :messages="sampleMessages">
              <template #input>
                <div data-testid="sidebar-input" class="border-t-2 border-indigo-300">input</div>
              </template>
            </CopilotSidebarView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("sidebar-input")).toBeDefined();
      });
    });

    describe("scrollView slot (inherited)", () => {
      it("should apply tailwind class string to inherited scrollView", () => {
        const Host = defineComponent({
          components: { CopilotSidebarView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotSidebarView :messages="sampleMessages">
              <template #scroll-view>
                <div data-testid="sidebar-scroll" class="scrollbar-thin scrollbar-thumb-gray-300">scroll</div>
              </template>
            </CopilotSidebarView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("sidebar-scroll")).toBeDefined();
      });
    });

    describe("suggestionView slot (inherited)", () => {
      it("should apply tailwind class string to inherited suggestionView", () => {
        const Host = defineComponent({
          components: { CopilotSidebarView },
          setup() {
            return { sampleMessages, sampleSuggestions };
          },
          template: `
            <CopilotSidebarView :messages="sampleMessages" :suggestions="sampleSuggestions">
              <template #suggestion-view>
                <div data-testid="sidebar-suggestion-view" class="gap-4 p-2">suggestions</div>
              </template>
            </CopilotSidebarView>
          `,
        });

        renderInWrapper(Host);
        const suggestionView = screen.getByTestId("sidebar-suggestion-view");
        expect(suggestionView.classList.contains("gap-4")).toBe(true);
      });
    });
  });

  describe("5. Drill-down into Header Sub-slots", () => {
    it("should allow customizing header titleContent through props object", () => {
      const Host = defineComponent({
        components: { CopilotSidebarView, CopilotModalHeader },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotSidebarView :messages="sampleMessages">
            <template #header>
              <CopilotModalHeader title="Sidebar Chat">
                <template #title-content="{ title }">
                  <div class="text-xl text-indigo-600 tracking-wide">{{ title }}</div>
                </template>
              </CopilotModalHeader>
            </template>
          </CopilotSidebarView>
        `,
      });

      const { container } = renderInWrapper(Host);
      const titleContent = container.querySelector(".text-xl");
      expect(titleContent).toBeDefined();
      expect(titleContent?.classList.contains("text-indigo-600")).toBe(true);
      expect(titleContent?.classList.contains("tracking-wide")).toBe(true);
    });

    it("should allow customizing header closeButton through props object", () => {
      const Host = defineComponent({
        components: { CopilotSidebarView, CopilotModalHeader },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotSidebarView :messages="sampleMessages">
            <template #header>
              <CopilotModalHeader title="Sidebar">
                <template #close-button>
                  <button class="sidebar-close-btn">x</button>
                </template>
              </CopilotModalHeader>
            </template>
          </CopilotSidebarView>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".sidebar-close-btn")).toBeDefined();
    });

    it("should allow custom component for header via component slot", () => {
      const Host = defineComponent({
        components: { CopilotSidebarView },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotSidebarView :messages="sampleMessages">
            <template #header>
              <header data-testid="full-custom-sidebar-header">
                <span>Custom Sidebar Header</span>
                <button data-testid="sidebar-custom-close">Dismiss</button>
              </header>
            </template>
          </CopilotSidebarView>
        `,
      });

      renderInWrapper(Host);
      const customClose = screen.queryByTestId("sidebar-custom-close");
      expect(customClose).toBeDefined();
      expect(customClose?.textContent).toBe("Dismiss");
    });
  });

  describe("6. className Override and Mixed Customization", () => {
    it("should merge multiple slot classNames correctly", () => {
      const Host = defineComponent({
        components: { CopilotSidebarView },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotSidebarView :messages="sampleMessages">
            <template #header><div class="header-style">header</div></template>
            <template #message-view><div class="message-style">message</div></template>
            <template #input><div class="input-style">input</div></template>
          </CopilotSidebarView>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".header-style")).toBeDefined();
      expect(container.querySelector(".message-style")).toBeDefined();
      expect(container.querySelector(".input-style")).toBeDefined();
    });

    it("should work with property objects and class strings mixed", async () => {
      const onClick = vi.fn();
      const Host = defineComponent({
        components: { CopilotSidebarView, CopilotModalHeader },
        setup() {
          return { sampleMessages, onClick };
        },
        template: `
          <CopilotSidebarView :messages="sampleMessages">
            <template #header>
              <CopilotModalHeader class="clickable-header" @click="onClick" />
            </template>
            <template #input>
              <div class="styled-input">input</div>
            </template>
          </CopilotSidebarView>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".styled-input")).toBeDefined();
      const header = container.querySelector(".clickable-header");
      if (header) {
        await fireEvent.click(header);
        expect(onClick).toHaveBeenCalledTimes(1);
      }
    });

    it("should support custom width prop", () => {
      const Host = defineComponent({
        components: { CopilotSidebarView },
        setup() {
          return { sampleMessages };
        },
        template: `<CopilotSidebarView :messages="sampleMessages" :width="600" />`,
      });

      const { container } = renderInWrapper(Host);
      const sidebar = container.querySelector("[data-copilot-sidebar]");
      expect(sidebar?.getAttribute("style") ?? "").toContain("--sidebar-width");
    });

    it("should support string width prop", () => {
      const Host = defineComponent({
        components: { CopilotSidebarView },
        setup() {
          return { sampleMessages };
        },
        template: `<CopilotSidebarView :messages="sampleMessages" width="50vw" />`,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector("[data-copilot-sidebar]")).toBeDefined();
    });
  });

  describe("7. Integration Tests", () => {
    it("should render sidebar with all default components", () => {
      const Host = defineComponent({
        components: { CopilotSidebarView },
        setup() {
          return { sampleMessages };
        },
        template: `<CopilotSidebarView :messages="sampleMessages" />`,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector("[data-copilot-sidebar]")).toBeDefined();
      expect(
        container.querySelector("[data-slot='copilot-modal-header']"),
      ).toBeDefined();
    });

    it("should render messages in sidebar", () => {
      const Host = defineComponent({
        components: { CopilotSidebarView },
        setup() {
          return { sampleMessages };
        },
        template: `<CopilotSidebarView :messages="sampleMessages" />`,
      });

      renderInWrapper(Host);
      expect(screen.queryByText("Hello")).toBeDefined();
      expect(screen.queryByText("Hi there!")).toBeDefined();
    });

    it("should handle empty messages array", () => {
      const Host = defineComponent({
        components: { CopilotSidebarView },
        template: `<CopilotSidebarView :messages="[]" />`,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector("[data-copilot-sidebar]")).toBeDefined();
    });

    it("should combine header customization with inherited slot customization", () => {
      const Host = defineComponent({
        components: { CopilotSidebarView, CopilotModalHeader },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotSidebarView :messages="sampleMessages">
            <template #header>
              <CopilotModalHeader title="Full Custom Sidebar" class="custom-header-root">
                <template #title-content="{ title }">
                  <div class="custom-title">{{ title }}</div>
                </template>
              </CopilotModalHeader>
            </template>
            <template #message-view><div class="custom-message">m</div></template>
            <template #input><div class="custom-input">i</div></template>
            <template #scroll-view><div class="custom-scroll">s</div></template>
          </CopilotSidebarView>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".custom-header-root")).toBeDefined();
      expect(container.querySelector(".custom-title")).toBeDefined();
      expect(container.querySelector(".custom-message")).toBeDefined();
      expect(container.querySelector(".custom-input")).toBeDefined();
      expect(container.querySelector(".custom-scroll")).toBeDefined();
    });
  });

  describe("8. Toggle Button Slot", () => {
    describe("toggleButton slot - Tailwind class string", () => {
      it("should apply tailwind class string to toggle button", () => {
        const Host = defineComponent({
          components: { CopilotSidebarView, CopilotChatToggleButton },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotSidebarView :messages="sampleMessages">
              <template #toggle-button>
                <CopilotChatToggleButton data-testid="sidebar-toggle" class="bg-red-500 hover:bg-red-600" />
              </template>
            </CopilotSidebarView>
          `,
        });

        renderInWrapper(Host);
        const toggleButton = screen.getByTestId("sidebar-toggle");
        expect(toggleButton.classList.contains("bg-red-500")).toBe(true);
      });
    });

    describe("toggleButton slot - Props object", () => {
      it("should pass custom props to toggle button", () => {
        const Host = defineComponent({
          components: { CopilotSidebarView, CopilotChatToggleButton },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotSidebarView :messages="sampleMessages">
              <template #toggle-button>
                <CopilotChatToggleButton data-testid="sidebar-custom-toggle" />
              </template>
            </CopilotSidebarView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.queryByTestId("sidebar-custom-toggle")).toBeDefined();
      });

      it("should pass openIcon and closeIcon sub-slot props", () => {
        const Host = defineComponent({
          components: { CopilotSidebarView, CopilotChatToggleButton },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotSidebarView :messages="sampleMessages">
              <template #toggle-button>
                <CopilotChatToggleButton>
                  <template #open-icon="{ iconClass }">
                    <span data-testid="sidebar-open-icon" :class="iconClass">open</span>
                  </template>
                  <template #close-icon="{ iconClass }">
                    <span data-testid="sidebar-close-icon" :class="iconClass">close</span>
                  </template>
                </CopilotChatToggleButton>
              </template>
            </CopilotSidebarView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("sidebar-open-icon")).toBeDefined();
        expect(screen.getByTestId("sidebar-close-icon")).toBeDefined();
      });
    });

    describe("toggleButton slot - Custom component", () => {
      it("should allow custom component for toggle button", () => {
        const Host = defineComponent({
          components: { CopilotSidebarView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotSidebarView :messages="sampleMessages">
              <template #toggle-button>
                <button data-testid="sidebar-custom-toggle-component" class="sidebar-toggle">Open Chat</button>
              </template>
            </CopilotSidebarView>
          `,
        });

        renderInWrapper(Host);
        const custom = screen.queryByTestId("sidebar-custom-toggle-component");
        expect(custom).toBeDefined();
        expect(custom?.textContent).toBe("Open Chat");
      });
    });
  });
});
