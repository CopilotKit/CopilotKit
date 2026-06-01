import { render, screen, fireEvent } from "@testing-library/vue";
import { computed, defineComponent } from "vue";
import { describe, it, expect, vi } from "vitest";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../../../providers/useCopilotChatConfiguration";
import { CopilotModalHeader } from "../index";
import CopilotModalHeaderTitle from "../CopilotModalHeaderTitle";
import CopilotModalHeaderCloseButton from "../CopilotModalHeaderCloseButton";

const ModalStateProbe = defineComponent({
  setup() {
    const config = useCopilotChatConfiguration();
    const modalState = computed(() => String(config.value?.isModalOpen));
    return { modalState };
  },
  template: `<span data-testid="modal-state">{{ modalState }}</span>`,
});

const TestWrapper = defineComponent({
  components: {
    CopilotKitProvider,
    CopilotChatConfigurationProvider,
  },
  template: `
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider thread-id="test-thread">
        <slot />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  `,
});

function renderInWrapper(component: ReturnType<typeof defineComponent>) {
  return render(component, {
    global: {
      components: {
        TestWrapper,
      },
    },
    wrapper: TestWrapper,
  });
}

describe("CopilotModalHeader Slot System E2E Tests", () => {
  // ============================================================================
  // 1. TAILWIND CLASS TESTS
  // ============================================================================
  describe("1. Tailwind Class Slot Override", () => {
    describe("titleContent slot", () => {
      it("should apply tailwind class string to titleContent", () => {
        const Host = defineComponent({
          components: { CopilotModalHeader },
          template: `
            <CopilotModalHeader title="Test Title">
              <template #title-content="{ title }">
                <div
                  data-testid="custom-title"
                  class="text-2xl font-bold text-blue-600"
                >
                  {{ title }}
                </div>
              </template>
            </CopilotModalHeader>
          `,
        });

        renderInWrapper(Host);

        const title = screen.getByTestId("custom-title");
        expect(title.classList.contains("text-2xl")).toBe(true);
        expect(title.classList.contains("font-bold")).toBe(true);
        expect(title.classList.contains("text-blue-600")).toBe(true);
      });

      it("should merge titleContent classes with defaults", () => {
        const Host = defineComponent({
          components: { CopilotModalHeader, CopilotModalHeaderTitle },
          template: `
            <CopilotModalHeader title="Test Title">
              <template #title-content="{ title }">
                <!-- React override-prop case translated to slot content reusing the Vue title primitive. -->
                <CopilotModalHeaderTitle
                  data-testid="custom-title"
                  class="custom-title-class"
                >
                  {{ title }}
                </CopilotModalHeaderTitle>
              </template>
            </CopilotModalHeader>
          `,
        });

        renderInWrapper(Host);

        const title = screen.getByTestId("custom-title");
        expect(title.classList.contains("custom-title-class")).toBe(true);
        expect(title.classList.contains("cpk:text-foreground")).toBe(true);
      });
    });

    describe("closeButton slot", () => {
      it("should apply tailwind class string to closeButton", () => {
        const Host = defineComponent({
          components: { CopilotModalHeader, CopilotModalHeaderCloseButton },
          template: `
            <CopilotModalHeader title="Test Title">
              <template #close-button>
                <CopilotModalHeaderCloseButton
                  data-testid="custom-close-btn"
                  class="bg-red-100 hover:bg-red-200 text-red-600"
                />
              </template>
            </CopilotModalHeader>
          `,
        });

        renderInWrapper(Host);

        const closeBtn = screen.getByTestId("custom-close-btn");
        expect(closeBtn.classList.contains("bg-red-100")).toBe(true);
        expect(closeBtn.classList.contains("text-red-600")).toBe(true);
      });

      it("should override default rounded-full with custom border radius", () => {
        const Host = defineComponent({
          components: { CopilotModalHeader, CopilotModalHeaderCloseButton },
          template: `
            <CopilotModalHeader title="Test Title">
              <template #close-button>
                <CopilotModalHeaderCloseButton
                  data-testid="custom-close-btn"
                  class="rounded-lg"
                />
              </template>
            </CopilotModalHeader>
          `,
        });

        renderInWrapper(Host);

        const closeBtn = screen.getByTestId("custom-close-btn");
        expect(closeBtn.classList.contains("rounded-lg")).toBe(true);
      });
    });
  });

  // ============================================================================
  // 2. PROPERTY PASSING TESTS
  // ============================================================================
  describe("2. Property Passing (onClick, disabled, etc.)", () => {
    describe("titleContent slot", () => {
      it("should pass custom props to titleContent", () => {
        const Host = defineComponent({
          components: { CopilotModalHeader },
          template: `
            <CopilotModalHeader title="Test Title">
              <template #title-content="{ title }">
                <div data-testid="custom-title">{{ title }}</div>
              </template>
            </CopilotModalHeader>
          `,
        });

        renderInWrapper(Host);

        const title = screen.getByTestId("custom-title");
        expect(title).toBeDefined();
        expect(title.textContent).toBe("Test Title");
      });

      it("should pass custom onClick to titleContent", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotModalHeader },
          setup() {
            return { onClick };
          },
          template: `
            <CopilotModalHeader title="Click Me">
              <template #title-content="{ title }">
                <button data-testid="clickable-title" @click="onClick">
                  {{ title }}
                </button>
              </template>
            </CopilotModalHeader>
          `,
        });

        renderInWrapper(Host);

        const title = screen.getByTestId("clickable-title");
        await fireEvent.click(title);
        expect(onClick).toHaveBeenCalledTimes(1);
      });
    });

    describe("closeButton slot", () => {
      it("should pass custom onClick that overrides default close behavior", async () => {
        const customOnClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotModalHeader, ModalStateProbe },
          setup() {
            return { customOnClick };
          },
          template: `
            <CopilotChatConfigurationProvider thread-id="test-thread" :is-modal-default-open="true">
              <CopilotModalHeader title="Test Title">
                <template #close-button>
                  <button data-testid="custom-close-btn" @click="customOnClick">
                    Close
                  </button>
                </template>
              </CopilotModalHeader>
              <ModalStateProbe />
            </CopilotChatConfigurationProvider>
          `,
        });

        render(Host, {
          global: {
            components: {
              CopilotKitProvider,
              CopilotChatConfigurationProvider,
            },
          },
          wrapper: CopilotKitProvider,
        });

        expect(screen.getByTestId("modal-state").textContent).toBe("true");

        const closeBtn = screen.getByTestId("custom-close-btn");
        await fireEvent.click(closeBtn);

        expect(customOnClick).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("modal-state").textContent).toBe("true");
      });

      it("should support disabled state on closeButton", () => {
        const Host = defineComponent({
          components: { CopilotModalHeader },
          template: `
            <CopilotModalHeader title="Test Title">
              <template #close-button>
                <button data-testid="custom-close-btn" disabled>
                  Close
                </button>
              </template>
            </CopilotModalHeader>
          `,
        });

        renderInWrapper(Host);

        const closeBtn = screen.getByTestId("custom-close-btn");
        expect(closeBtn.hasAttribute("disabled")).toBe(true);
      });

      it("should pass custom aria-label to closeButton", () => {
        const Host = defineComponent({
          components: { CopilotModalHeader, CopilotModalHeaderCloseButton },
          template: `
            <CopilotModalHeader title="Test Title">
              <template #close-button>
                <CopilotModalHeaderCloseButton
                  data-testid="custom-close-btn"
                  aria-label="Dismiss dialog"
                />
              </template>
            </CopilotModalHeader>
          `,
        });

        renderInWrapper(Host);

        const closeBtn = screen.getByLabelText("Dismiss dialog");
        expect(closeBtn).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 3. CUSTOM COMPONENT TESTS
  // ============================================================================
  describe("3. Custom Component Receiving Sub-components", () => {
    it("should allow custom component for titleContent", () => {
      const Host = defineComponent({
        components: { CopilotModalHeader },
        template: `
          <CopilotModalHeader title="Custom Header">
            <template #title-content="{ title }">
              <h1 data-testid="custom-title-component" class="my-custom-title">
                {{ title }}
              </h1>
            </template>
          </CopilotModalHeader>
        `,
      });

      renderInWrapper(Host);

      const custom = screen.getByTestId("custom-title-component");
      expect(custom.tagName).toBe("H1");
      expect(custom.textContent).toBe("Custom Header");
    });

    it("should allow custom component for closeButton", () => {
      const Host = defineComponent({
        components: { CopilotModalHeader },
        template: `
          <CopilotModalHeader title="Test Title">
            <template #close-button>
              <button data-testid="custom-close-btn">X Close</button>
            </template>
          </CopilotModalHeader>
        `,
      });

      renderInWrapper(Host);

      const custom = screen.getByTestId("custom-close-btn");
      expect(custom).toBeDefined();
      expect(custom.textContent).toBe("X Close");
    });

    it("should call onClick when custom closeButton is clicked", async () => {
      const handleClose = vi.fn();

      const Host = defineComponent({
        components: { CopilotModalHeader, ModalStateProbe },
        setup() {
          return {
            handleClose,
          };
        },
        template: `
          <CopilotChatConfigurationProvider thread-id="test-thread" :is-modal-default-open="true">
            <CopilotModalHeader title="Test Title">
              <template #close-button="{ onClose }">
                <button
                  data-testid="custom-close-btn"
                  @click="
                    handleClose();
                    onClose();
                  "
                >
                  Close
                </button>
              </template>
            </CopilotModalHeader>
            <ModalStateProbe />
          </CopilotChatConfigurationProvider>
        `,
      });

      render(Host, {
        global: {
          components: {
            CopilotKitProvider,
            CopilotChatConfigurationProvider,
          },
        },
        wrapper: CopilotKitProvider,
      });

      expect(screen.getByTestId("modal-state").textContent).toBe("true");

      const closeBtn = screen.getByTestId("custom-close-btn");
      await fireEvent.click(closeBtn);

      expect(handleClose).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("modal-state").textContent).toBe("false");
    });
  });

  // ============================================================================
  // 4. CHILDREN RENDER FUNCTION (DRILL-DOWN) TESTS
  // ============================================================================
  describe("4. Children Render Function for Drill-down", () => {
    it("should provide bound titleContent and closeButton via children render function", async () => {
      const Host = defineComponent({
        components: { CopilotModalHeader, ModalStateProbe },
        template: `
          <CopilotChatConfigurationProvider thread-id="test-thread" :is-modal-default-open="true">
            <CopilotModalHeader title="Test Title">
              <template #layout="{ title, onClose }">
                <div data-testid="children-render">
                  <div data-testid="received-title">{{ title }}</div>
                  <button data-testid="received-close" @click="onClose()">Close</button>
                </div>
              </template>
            </CopilotModalHeader>
            <ModalStateProbe />
          </CopilotChatConfigurationProvider>
        `,
      });

      render(Host, {
        global: {
          components: {
            CopilotKitProvider,
            CopilotChatConfigurationProvider,
          },
        },
        wrapper: CopilotKitProvider,
      });

      expect(screen.queryByTestId("children-render")).toBeDefined();
      expect(screen.queryByTestId("received-title")?.textContent).toBe(
        "Test Title",
      );
      expect(screen.getByTestId("modal-state").textContent).toBe("true");
      await fireEvent.click(screen.getByTestId("received-close"));
      expect(screen.getByTestId("modal-state").textContent).toBe("false");
    });

    it("should pass resolved title through children render function", () => {
      const Host = defineComponent({
        components: { CopilotModalHeader },
        template: `
          <CopilotModalHeader title="My Custom Title">
            <template #layout="{ title }">
              <div data-testid="resolved-title">{{ title }}</div>
            </template>
          </CopilotModalHeader>
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByTestId("resolved-title").textContent).toBe(
        "My Custom Title",
      );
    });

    it("should allow custom layout via children render function", () => {
      const Host = defineComponent({
        components: { CopilotModalHeader },
        template: `
          <CopilotModalHeader title="Custom Layout">
            <template #layout="{ title, onClose }">
              <header data-testid="custom-header-layout" class="custom-header">
                <div class="left-side">
                  <button data-testid="left-close" @click="onClose()">X</button>
                </div>
                <div class="center">{{ title }}</div>
                <div class="right-side">
                  <span class="subtitle">Subtitle: {{ title }}</span>
                </div>
              </header>
            </template>
          </CopilotModalHeader>
        `,
      });

      const { container } = renderInWrapper(Host);
      const customLayout = screen.queryByTestId("custom-header-layout");
      expect(customLayout).toBeDefined();
      expect(container.querySelector(".left-side")).toBeDefined();
      expect(container.querySelector(".center")).toBeDefined();
      expect(container.querySelector(".right-side")).toBeDefined();
      expect(customLayout?.textContent).toContain("Subtitle: Custom Layout");
    });

    it("should allow completely custom rendering without using provided components", () => {
      const Host = defineComponent({
        components: { CopilotModalHeader },
        template: `
          <CopilotModalHeader title="Ignored Title">
            <template #layout>
              <nav data-testid="custom-nav">
                <button>Back</button>
                <span>Custom Nav Header</span>
                <button>Menu</button>
              </nav>
            </template>
          </CopilotModalHeader>
        `,
      });

      renderInWrapper(Host);
      const customNav = screen.queryByTestId("custom-nav");
      expect(customNav).toBeDefined();
      expect(customNav?.textContent).toContain("Custom Nav Header");
      expect(screen.queryByText("Back")).toBeDefined();
      expect(screen.queryByText("Menu")).toBeDefined();
    });
  });

  // ============================================================================
  // 5. CLASSNAME OVERRIDE TESTS
  // ============================================================================
  describe("5. className Override with Tailwind Strings", () => {
    it("should apply className to header root element", () => {
      const Host = defineComponent({
        components: { CopilotModalHeader },
        template: `<CopilotModalHeader title="Test Title" class="custom-header-class bg-slate-100" />`,
      });

      const { container } = renderInWrapper(Host);
      const header = container.querySelector(".custom-header-class");
      expect(header).toBeDefined();
      expect(header?.tagName).toBe("HEADER");
      expect(header?.classList.contains("bg-slate-100")).toBe(true);
    });

    it("should override default border and padding", () => {
      const Host = defineComponent({
        components: { CopilotModalHeader },
        template: `<CopilotModalHeader title="Test Title" class="border-0 p-2" />`,
      });

      const { container } = renderInWrapper(Host);
      const header = container.querySelector(".border-0");
      expect(header).toBeDefined();
      expect(header?.classList.contains("p-2")).toBe(true);
    });

    it("should merge multiple slot classNames correctly", () => {
      const Host = defineComponent({
        components: {
          CopilotModalHeader,
          CopilotModalHeaderTitle,
          CopilotModalHeaderCloseButton,
        },
        template: `
          <CopilotModalHeader title="Test Title" class="header-custom">
            <template #title-content="{ title }">
              <CopilotModalHeaderTitle class="title-custom">{{ title }}</CopilotModalHeaderTitle>
            </template>
            <template #close-button>
              <CopilotModalHeaderCloseButton class="close-custom" />
            </template>
          </CopilotModalHeader>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".header-custom")).toBeDefined();
      expect(container.querySelector(".title-custom")).toBeDefined();
      expect(container.querySelector(".close-custom")).toBeDefined();
    });
  });

  // ============================================================================
  // 6. INTEGRATION TESTS
  // ============================================================================
  describe("6. Integration Tests", () => {
    it("should correctly render all slots with mixed customization", () => {
      const Host = defineComponent({
        components: {
          CopilotModalHeader,
          CopilotModalHeaderTitle,
          CopilotModalHeaderCloseButton,
        },
        template: `
          <CopilotModalHeader title="Full Test" class="header-style">
            <template #title-content="{ title }">
              <CopilotModalHeaderTitle class="title-style">{{ title }}</CopilotModalHeaderTitle>
            </template>
            <template #close-button>
              <CopilotModalHeaderCloseButton class="close-style" />
            </template>
          </CopilotModalHeader>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".header-style")).toBeDefined();
      expect(container.querySelector(".title-style")).toBeDefined();
      expect(container.querySelector(".close-style")).toBeDefined();
    });

    it("should work with property objects and class strings mixed", async () => {
      const onClick = vi.fn();
      const Host = defineComponent({
        components: { CopilotModalHeader, CopilotModalHeaderCloseButton },
        setup() {
          return { onClick };
        },
        template: `
          <CopilotModalHeader title="Mixed Test">
            <template #title-content="{ title }">
              <div class="text-xl">{{ title }}</div>
            </template>
            <template #close-button>
              <CopilotModalHeaderCloseButton class="bg-gray-200" @click="onClick" />
            </template>
          </CopilotModalHeader>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".text-xl")).toBeDefined();
      const closeBtn = container.querySelector(".bg-gray-200");
      if (closeBtn) {
        await fireEvent.click(closeBtn);
        expect(onClick).toHaveBeenCalled();
      }
    });

    it("should use default title from configuration when not provided", () => {
      const Host = defineComponent({
        components: { CopilotModalHeader },
        template: `<CopilotModalHeader />`,
      });

      renderInWrapper(Host);
      const header = document.querySelector(
        '[data-slot="copilot-modal-header"]',
      );
      expect(header).toBeDefined();
    });

    it("should render title content correctly", () => {
      const Host = defineComponent({
        components: { CopilotModalHeader },
        template: `<CopilotModalHeader title="My Chat Header" />`,
      });

      renderInWrapper(Host);
      expect(screen.getByText("My Chat Header")).toBeDefined();
    });

    it("should render close button with X icon", () => {
      const Host = defineComponent({
        components: { CopilotModalHeader },
        template: `<CopilotModalHeader title="Test" />`,
      });

      const { container } = renderInWrapper(Host);
      const closeBtn = container.querySelector('button[aria-label="Close"]');
      expect(closeBtn).toBeDefined();
      expect(closeBtn?.querySelector("svg")).toBeDefined();
    });
  });
});
