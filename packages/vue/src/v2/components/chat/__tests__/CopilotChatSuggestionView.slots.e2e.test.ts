import { render, screen, fireEvent } from "@testing-library/vue";
import { defineComponent } from "vue";
import { describe, it, expect, vi } from "vitest";
import type { Suggestion } from "@copilotkit/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatSuggestionView from "../CopilotChatSuggestionView.vue";

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

const createSuggestions = (): Suggestion[] => [
  { title: "Suggestion 1", message: "Message 1", isLoading: false },
  { title: "Suggestion 2", message: "Message 2", isLoading: false },
  { title: "Suggestion 3", message: "Message 3", isLoading: false },
];

describe("CopilotChatSuggestionView Slot System E2E Tests", () => {
  describe("1. Tailwind Class Slot Override", () => {
    describe("container slot", () => {
      it("should apply tailwind class string to container", () => {
        const Host = defineComponent({
          components: { CopilotChatSuggestionView },
          setup() {
            return { suggestions: createSuggestions() };
          },
          template: `
            <CopilotChatSuggestionView :suggestions="suggestions">
              <template #container="{ suggestions, onSelectSuggestion }">
                <div data-testid="custom-container" class="flex gap-4 bg-blue-50 p-4">
                  <button
                    v-for="(suggestion, index) in suggestions"
                    :key="suggestion.title"
                    type="button"
                    @click="onSelectSuggestion(suggestion, index)"
                  >
                    {{ suggestion.title }}
                  </button>
                </div>
              </template>
            </CopilotChatSuggestionView>
          `,
        });

        renderInWrapper(Host);
        const containerEl = screen.getByTestId("custom-container");
        expect(containerEl.classList.contains("gap-4")).toBe(true);
        expect(containerEl.classList.contains("bg-blue-50")).toBe(true);
        expect(containerEl.classList.contains("p-4")).toBe(true);
      });

      it("should merge container classes with default flex-wrap", () => {
        const Host = defineComponent({
          components: { CopilotChatSuggestionView },
          setup() {
            return { suggestions: createSuggestions() };
          },
          template: `
            <CopilotChatSuggestionView
              :suggestions="suggestions"
              class="custom-container-class"
            />
          `,
        });

        renderInWrapper(Host);
        const containerEl = document.querySelector(".custom-container-class");
        expect(containerEl).toBeTruthy();
        expect(containerEl?.classList.contains("cpk:flex-wrap")).toBe(true);
      });
    });

    describe("suggestion slot", () => {
      it("should apply tailwind class string to all suggestion pills", () => {
        const Host = defineComponent({
          components: { CopilotChatSuggestionView },
          setup() {
            return { suggestions: createSuggestions() };
          },
          template: `
            <CopilotChatSuggestionView :suggestions="suggestions">
              <template #suggestion="{ suggestion, onSelect }">
                <button
                  class="bg-green-100 hover:bg-green-200 rounded-full"
                  type="button"
                  @click="onSelect"
                >
                  {{ suggestion.title }}
                </button>
              </template>
            </CopilotChatSuggestionView>
          `,
        });

        renderInWrapper(Host);
        const pills = document.querySelectorAll(".bg-green-100");
        expect(pills.length).toBe(3);
      });
    });
  });

  describe("2. Property Passing (onClick, disabled, etc.)", () => {
    describe("container slot", () => {
      it("should pass custom props to container", () => {
        const Host = defineComponent({
          components: { CopilotChatSuggestionView },
          setup() {
            return { suggestions: createSuggestions() };
          },
          template: `
            <CopilotChatSuggestionView :suggestions="suggestions">
              <template #container="{ suggestions, onSelectSuggestion }">
                <div data-testid="custom-container">
                  <button
                    v-for="(suggestion, index) in suggestions"
                    :key="suggestion.title"
                    type="button"
                    @click="onSelectSuggestion(suggestion, index)"
                  >
                    {{ suggestion.title }}
                  </button>
                </div>
              </template>
            </CopilotChatSuggestionView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("custom-container")).toBeDefined();
      });

      it("should pass custom onClick to container", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatSuggestionView },
          setup() {
            return { suggestions: createSuggestions(), onClick };
          },
          template: `
            <CopilotChatSuggestionView :suggestions="suggestions">
              <template #container="{ suggestions, onSelectSuggestion }">
                <div data-testid="clickable-container" @click="onClick">
                  <button
                    v-for="(suggestion, index) in suggestions"
                    :key="suggestion.title"
                    type="button"
                    @click.stop="onSelectSuggestion(suggestion, index)"
                  >
                    {{ suggestion.title }}
                  </button>
                </div>
              </template>
            </CopilotChatSuggestionView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("clickable-container"));
        expect(onClick).toHaveBeenCalledTimes(1);
      });
    });

    describe("suggestion slot", () => {
      it("should apply custom type to suggestion buttons", () => {
        const Host = defineComponent({
          components: { CopilotChatSuggestionView },
          setup() {
            return { suggestions: createSuggestions() };
          },
          template: `
            <CopilotChatSuggestionView :suggestions="suggestions">
              <template #suggestion="{ suggestion, onSelect }">
                <button type="submit" @click="onSelect">
                  {{ suggestion.title }}
                </button>
              </template>
            </CopilotChatSuggestionView>
          `,
        });

        renderInWrapper(Host);
        const buttons = document.querySelectorAll('button[type="submit"]');
        expect(buttons.length).toBe(3);
      });

      it("should apply disabled state to all suggestion pills", () => {
        const Host = defineComponent({
          components: { CopilotChatSuggestionView },
          setup() {
            return { suggestions: createSuggestions() };
          },
          template: `
            <CopilotChatSuggestionView :suggestions="suggestions">
              <template #suggestion="{ suggestion, onSelect }">
                <button disabled type="button" @click="onSelect">
                  {{ suggestion.title }}
                </button>
              </template>
            </CopilotChatSuggestionView>
          `,
        });

        renderInWrapper(Host);
        const buttons = document.querySelectorAll("button[disabled]");
        expect(buttons.length).toBe(3);
      });
    });

    describe("onSelectSuggestion callback", () => {
      it("should call onSelectSuggestion when suggestion is clicked", async () => {
        const onSelectSuggestion = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatSuggestionView },
          setup() {
            return { suggestions: createSuggestions(), onSelectSuggestion };
          },
          template: `
            <CopilotChatSuggestionView
              :suggestions="suggestions"
              @select-suggestion="onSelectSuggestion"
            />
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByText("Suggestion 1"));
        expect(onSelectSuggestion).toHaveBeenCalledWith(
          createSuggestions()[0],
          0,
        );
      });

      it("should call onSelectSuggestion with correct index for each suggestion", async () => {
        const suggestions = createSuggestions();
        const onSelectSuggestion = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatSuggestionView },
          setup() {
            return { suggestions, onSelectSuggestion };
          },
          template: `
            <CopilotChatSuggestionView
              :suggestions="suggestions"
              @select-suggestion="onSelectSuggestion"
            />
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByText("Suggestion 2"));
        await fireEvent.click(screen.getByText("Suggestion 3"));
        expect(onSelectSuggestion).toHaveBeenCalledWith(suggestions[1], 1);
        expect(onSelectSuggestion).toHaveBeenCalledWith(suggestions[2], 2);
      });
    });
  });

  describe("3. Custom Component Receiving Sub-components", () => {
    it("should allow custom component for container", () => {
      const CustomContainer = defineComponent({
        template: `
          <div data-testid="custom-container-component">
            <span>Suggestions:</span>
            <slot />
          </div>
        `,
      });

      const Host = defineComponent({
        components: { CopilotChatSuggestionView, CustomContainer },
        setup() {
          return { suggestions: createSuggestions() };
        },
        template: `
          <CopilotChatSuggestionView :suggestions="suggestions">
            <template #container="{ suggestions, onSelectSuggestion }">
              <CustomContainer>
                <button
                  v-for="(suggestion, index) in suggestions"
                  :key="suggestion.title"
                  type="button"
                  @click="onSelectSuggestion(suggestion, index)"
                >
                  {{ suggestion.title }}
                </button>
              </CustomContainer>
            </template>
          </CopilotChatSuggestionView>
        `,
      });

      renderInWrapper(Host);
      const custom = screen.getByTestId("custom-container-component");
      expect(custom.textContent).toContain("Suggestions:");
    });

    it("should allow custom component for suggestion pills", () => {
      const CustomSuggestionPill = defineComponent({
        props: {
          title: { type: String, required: true },
        },
        emits: ["select"],
        template: `
          <button data-testid="custom-pill" @click="$emit('select')">[{{ title }}]</button>
        `,
      });

      const Host = defineComponent({
        components: { CopilotChatSuggestionView, CustomSuggestionPill },
        setup() {
          return { suggestions: createSuggestions() };
        },
        template: `
          <CopilotChatSuggestionView :suggestions="suggestions">
            <template #suggestion="{ suggestion, onSelect }">
              <CustomSuggestionPill
                :title="suggestion.title"
                @select="onSelect"
              />
            </template>
          </CopilotChatSuggestionView>
        `,
      });

      renderInWrapper(Host);
      const customPills = screen.getAllByTestId("custom-pill");
      expect(customPills).toHaveLength(3);
      expect(customPills[0]?.textContent).toBe("[Suggestion 1]");
    });

    it("should pass isLoading to custom suggestion component", () => {
      const suggestions: Suggestion[] = [
        { title: "Suggestion 1", message: "Message 1", isLoading: true },
        { title: "Suggestion 2", message: "Message 2", isLoading: false },
      ];

      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        setup() {
          return { suggestions };
        },
        template: `
          <CopilotChatSuggestionView :suggestions="suggestions">
            <template #suggestion="{ suggestion, isLoading }">
              <button data-testid="custom-pill" :data-loading="String(isLoading)">
                {{ isLoading ? "Loading..." : suggestion.title }}
              </button>
            </template>
          </CopilotChatSuggestionView>
        `,
      });

      renderInWrapper(Host);
      const pills = screen.getAllByTestId("custom-pill");
      expect(pills[0]?.getAttribute("data-loading")).toBe("true");
      expect(pills[0]?.textContent).toBe("Loading...");
      expect(pills[1]?.getAttribute("data-loading")).toBe("false");
    });
  });

  describe("4. Children Render Function for Drill-down", () => {
    it("should provide bound container and suggestion via children render function", () => {
      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        setup() {
          return { suggestions: createSuggestions() };
        },
        template: `
          <CopilotChatSuggestionView :suggestions="suggestions">
            <template #layout="{ suggestions, onSelectSuggestion }">
              <div data-testid="children-render">
                <div data-testid="received-container">{{ typeof onSelectSuggestion }}</div>
                <div data-testid="received-suggestion">{{ suggestions.length }}</div>
              </div>
            </template>
          </CopilotChatSuggestionView>
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByTestId("children-render")).toBeDefined();
      expect(screen.getByTestId("received-container").textContent).toBe(
        "function",
      );
      expect(screen.getByTestId("received-suggestion").textContent).toBe("3");
    });

    it("should pass suggestions array through children render function", () => {
      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        setup() {
          return { suggestions: createSuggestions() };
        },
        template: `
          <CopilotChatSuggestionView :suggestions="suggestions">
            <template #layout="{ suggestions }">
              <div data-testid="suggestion-count">{{ suggestions.length }}</div>
            </template>
          </CopilotChatSuggestionView>
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByTestId("suggestion-count").textContent).toBe("3");
    });

    it("should pass loadingIndexes through children render function", () => {
      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        setup() {
          return {
            suggestions: createSuggestions(),
            loadingIndexes: [0, 2],
          };
        },
        template: `
          <CopilotChatSuggestionView :suggestions="suggestions" :loading-indexes="loadingIndexes">
            <template #layout="{ loadingIndexes }">
              <div data-testid="loading-indexes">{{ loadingIndexes.join(",") }}</div>
            </template>
          </CopilotChatSuggestionView>
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByTestId("loading-indexes").textContent).toBe("0,2");
    });

    it("should allow custom layout via children render function", () => {
      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        setup() {
          return { suggestions: createSuggestions() };
        },
        template: `
          <CopilotChatSuggestionView :suggestions="suggestions">
            <template #layout="{ suggestions }">
              <div data-testid="custom-layout">
                <h3>Quick Actions</h3>
                <p>Total: {{ suggestions.length }}</p>
              </div>
            </template>
          </CopilotChatSuggestionView>
        `,
      });

      renderInWrapper(Host);
      const customLayout = screen.getByTestId("custom-layout");
      expect(customLayout.textContent).toContain("Quick Actions");
      expect(customLayout.textContent).toContain("Total: 3");
    });
  });

  describe("5. className Override with Tailwind Strings", () => {
    it("should apply className to container", () => {
      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        setup() {
          return { suggestions: createSuggestions() };
        },
        template: `
          <CopilotChatSuggestionView
            :suggestions="suggestions"
            class="custom-root-class mt-4"
          />
        `,
      });

      renderInWrapper(Host);
      const containerEl = document.querySelector(".custom-root-class");
      expect(containerEl).toBeTruthy();
      expect(containerEl?.classList.contains("mt-4")).toBe(true);
    });

    it("should merge className with container slot class", () => {
      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        setup() {
          return { suggestions: createSuggestions() };
        },
        template: `
          <CopilotChatSuggestionView :suggestions="suggestions" class="root-class">
            <template #container="{ suggestions, onSelectSuggestion, containerClass, containerAttrs }">
              <div
                class="container-class"
                :class="containerClass"
                v-bind="containerAttrs"
                data-testid="container-class"
              >
                <button
                  v-for="(suggestion, index) in suggestions"
                  :key="suggestion.title"
                  type="button"
                  @click="onSelectSuggestion(suggestion, index)"
                >
                  {{ suggestion.title }}
                </button>
              </div>
            </template>
          </CopilotChatSuggestionView>
        `,
      });

      renderInWrapper(Host);
      const containerEl = screen.getByTestId("container-class");
      expect(containerEl.classList.contains("container-class")).toBe(true);
      expect(containerEl.classList.contains("root-class")).toBe(true);
    });

    it("should allow overriding default pointer-events-none", () => {
      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        setup() {
          return { suggestions: createSuggestions() };
        },
        template: `
          <CopilotChatSuggestionView
            :suggestions="suggestions"
            class="pointer-events-auto"
          />
        `,
      });

      renderInWrapper(Host);
      const containerEl = document.querySelector(".pointer-events-auto");
      expect(containerEl).toBeTruthy();
    });
  });

  describe("6. Integration and Loading State Tests", () => {
    it("should correctly render all slots with mixed customization", () => {
      const onSelectSuggestion = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        setup() {
          return {
            suggestions: createSuggestions(),
            onSelectSuggestion,
          };
        },
        template: `
          <CopilotChatSuggestionView
            :suggestions="suggestions"
            class="container-style"
            @select-suggestion="onSelectSuggestion"
          >
            <template #suggestion="{ suggestion, onSelect }">
              <button class="suggestion-style" type="button" @click="onSelect">
                {{ suggestion.title }}
              </button>
            </template>
          </CopilotChatSuggestionView>
        `,
      });

      renderInWrapper(Host);
      expect(document.querySelector(".container-style")).toBeTruthy();
      expect(document.querySelectorAll(".suggestion-style")).toHaveLength(3);
    });

    it("should show loading state for specific indexes", () => {
      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        setup() {
          return {
            suggestions: createSuggestions(),
            loadingIndexes: [1],
          };
        },
        template: `
          <CopilotChatSuggestionView
            :suggestions="suggestions"
            :loading-indexes="loadingIndexes"
          />
        `,
      });

      renderInWrapper(Host);
      const buttons = screen.getAllByRole("button");
      expect(buttons[1]?.hasAttribute("disabled")).toBe(true);
    });

    it("should handle empty suggestions array", () => {
      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        template: `
          <CopilotChatSuggestionView :suggestions="[]" />
        `,
      });

      renderInWrapper(Host);
      const buttons = document.querySelectorAll("button");
      expect(buttons).toHaveLength(0);
    });

    it("should handle single suggestion", () => {
      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        setup() {
          return {
            suggestions: [
              {
                title: "Only One",
                message: "Single message",
                isLoading: false,
              },
            ] as Suggestion[],
          };
        },
        template: `
          <CopilotChatSuggestionView :suggestions="suggestions" />
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByText("Only One")).toBeDefined();
    });

    it("should work with property objects and class strings mixed", () => {
      const onClick = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatSuggestionView },
        setup() {
          return {
            suggestions: createSuggestions(),
            onClick,
          };
        },
        template: `
          <CopilotChatSuggestionView
            :suggestions="suggestions"
            class="flex gap-2"
            data-testid="mixed-container"
            @click="onClick"
          >
            <template #suggestion="{ suggestion, onSelect }">
              <button class="pill-style" type="button" @click.stop="onSelect">
                {{ suggestion.title }}
              </button>
            </template>
          </CopilotChatSuggestionView>
        `,
      });

      renderInWrapper(Host);
      const container = screen.getByTestId("mixed-container");
      expect(container.classList.contains("flex")).toBe(true);
      expect(container.classList.contains("gap-2")).toBe(true);
      expect(document.querySelectorAll(".pill-style")).toHaveLength(3);
    });
  });
});
