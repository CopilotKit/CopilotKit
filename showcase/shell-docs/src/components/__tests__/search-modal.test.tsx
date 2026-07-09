// @vitest-environment jsdom

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchModal } from "@/components/search-modal";
import type { Registry } from "@/lib/registry";
import { renderWithFumadocs } from "@/test/render-with-fumadocs";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const frameworkContext = vi.hoisted(() => ({
  effectiveFramework: "built-in-agent",
  setStoredFramework: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => navigation,
}));

vi.mock("@/components/framework-provider", () => ({
  DEFAULT_FRAMEWORK: "built-in-agent",
  useFramework: () => ({
    effectiveFramework: frameworkContext.effectiveFramework,
    setStoredFramework: frameworkContext.setStoredFramework,
  }),
}));

vi.mock("@/lib/runtime-config.client", () => ({
  getRuntimeConfig: () => ({ shellUrl: "https://showcase.test" }),
}));

const builtInIntegration: Registry["integrations"][number] = {
  name: "Built-in Agent",
  slug: "built-in-agent",
  category: "popular",
  language: "typescript",
  description: "CopilotKit's built-in agent",
  partner_docs: null,
  repo: "",
  copilotkit_version: "",
  backend_url: "",
  deployed: true,
  docs_mode: "authored",
  features: [],
  demos: [],
};

function createIntegration(
  slug: string,
  name: string,
  language: "python" | "typescript" = "typescript",
): Registry["integrations"][number] {
  return {
    ...builtInIntegration,
    name,
    slug,
    language,
    description: `${name} integration`,
  };
}

const registry: Registry = {
  integrations: [
    builtInIntegration,
    createIntegration("langgraph-python", "LangGraph Python", "python"),
    createIntegration("crewai-crews", "CrewAI Crews", "python"),
  ],
  feature_registry: {
    version: "test",
    categories: [{ id: "interaction", name: "Interaction" }],
    features: [
      {
        id: "agent-state",
        name: "Agent state",
        category: "interaction",
        description: "Share agent state with an application",
      },
    ],
  },
};

const overflowRegistry: Registry = {
  ...registry,
  integrations: [
    ...registry.integrations,
    createIntegration("google-adk", "Google ADK", "python"),
    createIntegration("strands", "AWS Strands", "python"),
    createIntegration("mastra", "Mastra"),
    createIntegration("pydantic-ai", "Pydantic AI", "python"),
    createIntegration("agno", "Agno", "python"),
    createIntegration("llamaindex", "LlamaIndex", "python"),
    createIntegration("spring-ai", "Spring AI"),
  ],
};

function deferredRegistry() {
  const callbacks: {
    resolve?: (value: Registry | PromiseLike<Registry>) => void;
    reject?: (reason?: unknown) => void;
  } = {};
  const promise = new Promise<Registry>((resolve, reject) => {
    callbacks.resolve = resolve;
    callbacks.reject = reject;
  });
  if (!callbacks.resolve || !callbacks.reject) {
    throw new Error("Failed to create deferred registry");
  }
  return { promise, resolve: callbacks.resolve, reject: callbacks.reject };
}

function getFrameworkListbox() {
  return screen.getByRole("listbox", { name: "Docs framework" });
}

function getFrameworkOption(name: RegExp) {
  return within(getFrameworkListbox()).getByRole("option", { name });
}

describe("SearchModal", () => {
  beforeEach(() => {
    navigation.push.mockReset();
    frameworkContext.effectiveFramework = "built-in-agent";
    frameworkContext.setStoredFramework.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes a combobox and labelled quick-destination groups while integrations load", async () => {
    const pendingRegistry = deferredRegistry();
    renderWithFumadocs(
      <SearchModal
        open
        onOpenChange={vi.fn()}
        loadRegistry={() => pendingRegistry.promise}
      />,
      navigation,
    );

    const input = await screen.findByRole("combobox", {
      name: "Search documentation",
    });
    const listboxId = input.getAttribute("aria-controls");

    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(listboxId).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("listbox").id).toBe(listboxId);
    expect(
      screen
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label")),
    ).toEqual(["Documentation", "API Reference", "AG-UI", "Integrations"]);
    expect(screen.getByRole("status").textContent).toContain(
      "Loading integration results",
    );
  });

  it("supports listbox keyboard navigation and ignores Enter during IME composition", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithFumadocs(
      <SearchModal
        open
        onOpenChange={onOpenChange}
        loadRegistry={() => Promise.resolve(registry)}
      />,
      navigation,
    );

    const input = await screen.findByRole("combobox", {
      name: "Search documentation",
    });
    await user.type(input, "CopilotChat");
    const options = await screen.findAllByRole("option");
    const firstOption = options[0];
    const lastOption = options.at(-1);
    if (!lastOption) throw new Error("Expected search results");

    expect(input.getAttribute("aria-activedescendant")).toBe(firstOption.id);
    await user.keyboard("{End}");
    expect(input.getAttribute("aria-activedescendant")).toBe(lastOption.id);
    await user.keyboard("{Home}{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
    await user.keyboard("{ArrowUp}");
    expect(input.getAttribute("aria-activedescendant")).toBe(firstOption.id);
    await user.keyboard("{ArrowDown}");

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(navigation.push).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await user.keyboard("{Enter}");
    expect(navigation.push).toHaveBeenCalledWith(expect.any(String));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("scrolls only the newly active keyboard result into view", async () => {
    const user = userEvent.setup();
    const pendingRegistry = deferredRegistry();
    const onOpenChange = vi.fn();
    const loadRegistry = () => pendingRegistry.promise;
    const { rerender } = renderWithFumadocs(
      <SearchModal
        open
        onOpenChange={onOpenChange}
        loadRegistry={loadRegistry}
      />,
      navigation,
    );

    const input = await screen.findByRole("combobox", {
      name: "Search documentation",
    });
    await user.type(input, "agent");
    const resultListbox = screen.getByRole("listbox", {
      name: "Search results",
    });
    const options = within(resultListbox).getAllByRole("option");
    const lastOption = options.at(-1);
    if (!lastOption) throw new Error("Expected search results");
    expect(options.length).toBeGreaterThan(5);

    const scrollIntoView = vi.fn();
    Object.defineProperty(lastOption, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    await user.keyboard("{End}");
    expect(input.getAttribute("aria-activedescendant")).toBe(lastOption.id);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    scrollIntoView.mockClear();
    rerender(
      <SearchModal
        open
        onOpenChange={onOpenChange}
        loadRegistry={loadRegistry}
      />,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps result options out of the dialog tab order", async () => {
    const user = userEvent.setup();
    renderWithFumadocs(
      <SearchModal
        open
        onOpenChange={vi.fn()}
        loadRegistry={() => Promise.resolve(registry)}
      />,
      navigation,
    );

    const input = await screen.findByRole("combobox", {
      name: "Search documentation",
    });
    const closeButton = screen.getByRole("button", { name: "Close search" });
    const frameworkTrigger = await screen.findByRole("button", {
      name: /Choose docs framework/,
    });
    const resultOptions = within(
      screen.getByRole("listbox", { name: "Search results" }),
    ).getAllByRole("option");

    expect(resultOptions.every((option) => option.tabIndex === -1)).toBe(true);
    expect(document.activeElement).toBe(input);
    await user.tab();
    expect(document.activeElement).toBe(closeButton);
    await user.tab();
    expect(document.activeElement).toBe(frameworkTrigger);
    await user.tab();
    expect(resultOptions).not.toContain(document.activeElement);
  });

  it("supports roving framework focus, selection, and dismissal", async () => {
    frameworkContext.effectiveFramework = "langgraph-python";
    const user = userEvent.setup();
    renderWithFumadocs(
      <SearchModal
        open
        onOpenChange={vi.fn()}
        loadRegistry={() => Promise.resolve(registry)}
      />,
      navigation,
    );

    const trigger = await screen.findByRole("button", {
      name: /Currently LangGraph Python/,
    });
    await user.click(trigger);
    let frameworkOptions = within(getFrameworkListbox()).getAllByRole("option");
    const langGraphOption = getFrameworkOption(/LangGraph Python/);
    let crewAIOption = getFrameworkOption(/CrewAI Crews/);
    let builtInOption = getFrameworkOption(/Built-in Agent/);

    await waitFor(() => expect(document.activeElement).toBe(langGraphOption));
    expect(frameworkOptions.filter((option) => option.tabIndex === 0)).toEqual([
      langGraphOption,
    ]);

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(crewAIOption);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(builtInOption);
    await user.keyboard("{Home}{ArrowUp}");
    expect(document.activeElement).toBe(langGraphOption);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(frameworkContext.setStoredFramework).toHaveBeenLastCalledWith(
      "crewai-crews",
    );
    expect(
      screen.queryByRole("listbox", { name: "Docs framework" }),
    ).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await user.click(trigger);
    frameworkOptions = within(getFrameworkListbox()).getAllByRole("option");
    crewAIOption = getFrameworkOption(/CrewAI Crews/);
    builtInOption = getFrameworkOption(/Built-in Agent/);
    await waitFor(() => expect(document.activeElement).toBe(crewAIOption));
    await user.keyboard("{End} ");
    expect(frameworkContext.setStoredFramework).toHaveBeenLastCalledWith(
      "built-in-agent",
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await user.click(trigger);
    builtInOption = getFrameworkOption(/Built-in Agent/);
    await waitFor(() => expect(document.activeElement).toBe(builtInOption));
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("listbox", { name: "Docs framework" }),
    ).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await user.click(trigger);
    frameworkOptions = within(getFrameworkListbox()).getAllByRole("option");
    builtInOption = getFrameworkOption(/Built-in Agent/);
    await waitFor(() => expect(document.activeElement).toBe(builtInOption));
    await user.tab();
    expect(
      screen.queryByRole("listbox", { name: "Docs framework" }),
    ).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
    expect(frameworkOptions).not.toContain(document.activeElement);
  });

  it("keeps programmatic framework focus visible in an overflowing listbox", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const loadRegistry = () => Promise.resolve(overflowRegistry);
    const scrollCalls: Array<{
      target: HTMLElement;
      options: boolean | ScrollIntoViewOptions | undefined;
    }> = [];
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
      function (this: HTMLElement, options?: boolean | ScrollIntoViewOptions) {
        scrollCalls.push({ target: this, options });
      },
    );
    const { rerender } = renderWithFumadocs(
      <SearchModal
        open
        onOpenChange={onOpenChange}
        loadRegistry={loadRegistry}
      />,
      navigation,
    );

    const trigger = await screen.findByRole("button", {
      name: /Currently Built-in Agent/,
    });
    const expectFocusedAndScrolled = async (option: HTMLElement) => {
      await waitFor(() => {
        expect(document.activeElement).toBe(option);
        expect(scrollCalls.at(-1)).toEqual({
          target: option,
          options: { block: "nearest" },
        });
      });
    };

    await user.click(trigger);
    const frameworkOptions = within(getFrameworkListbox()).getAllByRole(
      "option",
    );
    const firstOption = frameworkOptions[0];
    const lastOption = frameworkOptions.at(-1);
    const previousOption = frameworkOptions.at(-2);
    if (!firstOption || !lastOption || !previousOption) {
      throw new Error("Expected overflowing framework options");
    }
    expect(frameworkOptions.length).toBeGreaterThan(6);
    expect(lastOption).toBe(getFrameworkOption(/Built-in Agent/));
    expect(lastOption.getAttribute("aria-selected")).toBe("true");
    await expectFocusedAndScrolled(lastOption);

    scrollCalls.length = 0;
    await user.keyboard("{Home}");
    await expectFocusedAndScrolled(firstOption);

    scrollCalls.length = 0;
    await user.keyboard("{End}");
    await expectFocusedAndScrolled(lastOption);

    scrollCalls.length = 0;
    await user.keyboard("{ArrowUp}");
    await expectFocusedAndScrolled(previousOption);

    scrollCalls.length = 0;
    await user.keyboard("{ArrowDown}");
    await expectFocusedAndScrolled(lastOption);

    scrollCalls.length = 0;
    rerender(
      <SearchModal
        open
        onOpenChange={onOpenChange}
        loadRegistry={loadRegistry}
      />,
    );
    expect(document.activeElement).toBe(lastOption);
    expect(scrollCalls).toHaveLength(0);
  });

  it("refreshes framework scope on reopen without clearing the query", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const loadRegistry = () => Promise.resolve(registry);
    const { rerender } = renderWithFumadocs(
      <SearchModal
        open
        onOpenChange={onOpenChange}
        loadRegistry={loadRegistry}
      />,
      navigation,
    );

    const input = await screen.findByRole("combobox", {
      name: "Search documentation",
    });
    await user.type(input, "agent");
    rerender(
      <SearchModal
        open={false}
        onOpenChange={onOpenChange}
        loadRegistry={loadRegistry}
      />,
    );
    frameworkContext.effectiveFramework = "langgraph-python";
    rerender(
      <SearchModal
        open={false}
        onOpenChange={onOpenChange}
        loadRegistry={loadRegistry}
      />,
    );
    rerender(
      <SearchModal
        open
        onOpenChange={onOpenChange}
        loadRegistry={loadRegistry}
      />,
    );

    const reopenedInput = await screen.findByRole("combobox", {
      name: "Search documentation",
    });
    if (!(reopenedInput instanceof HTMLInputElement)) {
      throw new Error("Expected search input");
    }
    expect(reopenedInput.value).toBe("agent");
    const frameworkTrigger = await screen.findByRole("button", {
      name: /Currently LangGraph Python/,
    });

    await user.click(frameworkTrigger);
    const frameworkListbox = screen.getByRole("listbox", {
      name: "Docs framework",
    });
    await user.click(
      within(frameworkListbox).getByRole("option", {
        name: /CrewAI Crews/,
      }),
    );
    frameworkContext.effectiveFramework = "built-in-agent";
    rerender(
      <SearchModal
        open
        onOpenChange={onOpenChange}
        loadRegistry={loadRegistry}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Currently CrewAI Crews/ }),
    ).not.toBeNull();
    const currentInput = screen.getByRole("combobox", {
      name: "Search documentation",
    });
    if (!(currentInput instanceof HTMLInputElement)) {
      throw new Error("Expected search input");
    }
    expect(currentInput.value).toBe("agent");
  });

  it("keeps static results usable and explains registry degradation", async () => {
    const failedRegistry = deferredRegistry();
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithFumadocs(
      <SearchModal
        open
        onOpenChange={vi.fn()}
        loadRegistry={() => failedRegistry.promise}
      />,
      navigation,
    );

    const input = await screen.findByRole("combobox", {
      name: "Search documentation",
    });
    await userEvent.type(input, "CopilotChat");
    failedRegistry.reject(new Error("registry unavailable"));

    expect(await screen.findAllByRole("option")).not.toHaveLength(0);
    expect((await screen.findByRole("status")).textContent).toContain(
      "Integration results are unavailable. Documentation search still works.",
    );
  });

  it("shows query recovery guidance alongside a degraded integration notice", async () => {
    const failedRegistry = deferredRegistry();
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithFumadocs(
      <SearchModal
        open
        onOpenChange={vi.fn()}
        loadRegistry={() => failedRegistry.promise}
      />,
      navigation,
    );

    const input = await screen.findByRole("combobox", {
      name: "Search documentation",
    });
    await userEvent.type(input, "definitely-no-such-page");
    failedRegistry.reject(new Error("registry unavailable"));

    await waitFor(() => {
      const statuses = screen
        .getAllByRole("status")
        .map((status) => status.textContent);
      expect(statuses).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "No results for “definitely-no-such-page”. Try a different term or browse the quick destinations.",
          ),
          expect.stringContaining(
            "Integration results are unavailable. Documentation search still works.",
          ),
        ]),
      );
    });
  });

  it("names an empty result query and offers recovery guidance", async () => {
    renderWithFumadocs(
      <SearchModal
        open
        onOpenChange={vi.fn()}
        loadRegistry={() => Promise.resolve(registry)}
      />,
      navigation,
    );

    const input = await screen.findByRole("combobox", {
      name: "Search documentation",
    });
    await userEvent.type(input, "definitely-no-such-page");

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "No results for “definitely-no-such-page”. Try a different term or browse the quick destinations.",
      );
    });
  });

  it("focuses and selects the existing query whenever it reopens", async () => {
    const pendingRegistry = deferredRegistry();
    const onOpenChange = vi.fn();
    const loadRegistry = () => pendingRegistry.promise;
    const { rerender } = renderWithFumadocs(
      <SearchModal
        open
        onOpenChange={onOpenChange}
        loadRegistry={loadRegistry}
      />,
      navigation,
    );
    const input = await screen.findByRole("combobox", {
      name: "Search documentation",
    });
    await userEvent.type(input, "agent");

    rerender(
      <SearchModal
        open={false}
        onOpenChange={onOpenChange}
        loadRegistry={loadRegistry}
      />,
    );
    rerender(
      <SearchModal
        open
        onOpenChange={onOpenChange}
        loadRegistry={loadRegistry}
      />,
    );

    const reopenedInput = await screen.findByRole("combobox", {
      name: "Search documentation",
    });
    if (!(reopenedInput instanceof HTMLInputElement)) {
      throw new Error("Expected search input");
    }
    await waitFor(() => {
      expect(document.activeElement).toBe(reopenedInput);
      expect(reopenedInput.selectionStart).toBe(0);
      expect(reopenedInput.selectionEnd).toBe(5);
    });
  });
});
