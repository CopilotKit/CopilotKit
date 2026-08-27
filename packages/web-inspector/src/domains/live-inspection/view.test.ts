import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAgentScopeDropdown, renderAgentsView } from "./agents/view.js";
import { renderCapabilitiesView } from "./capabilities/view.js";
import { renderContextView } from "./context/view.js";
import { renderEventsView } from "./events/view.js";
import {
  AGENT_SCOPE_POPUP_ID,
  createLiveInspectionState,
  liveInspectionPanelId,
} from "./state.js";
import { mount, requireElement } from "./test-helpers.js";
import { renderToolsView } from "./tools/view.js";

const renderIcon = (name: string) => html`<span>${name}</span>`;

afterEach(() => document.body.replaceChildren());

describe("live inspection views", () => {
  it("renders event disclosures and column resizers as named buttons", () => {
    const state = createLiveInspectionState();
    const onToggle = vi.fn();
    const root = mount(
      renderEventsView({
        state,
        events: [
          {
            id: "alpha:1",
            agentId: "alpha",
            type: "RUN_STARTED",
            timestamp: 1,
            payload: { runId: "run-1" },
          },
        ],
        renderIcon,
        renderJson: (value) => html`<span>${JSON.stringify(value)}</span>`,
        onFilterInput: () => undefined,
        onAgentChange: () => undefined,
        onTypeChange: () => undefined,
        onResetFilters: () => undefined,
        onExport: () => undefined,
        onClear: () => undefined,
        onToggle,
        onResizeStart: () => undefined,
        onResizeMove: () => undefined,
        onResizeEnd: () => undefined,
        onResizeKeyDown: () => undefined,
      }),
    );

    expect(root.querySelector("caption")?.textContent).toContain(
      "Live AG-UI events",
    );
    expect(root.querySelectorAll('[role="separator"]')).toHaveLength(3);
    const resizer = requireElement(
      root.querySelector<HTMLElement>(".event-column-resizer"),
      "Missing event column resizer",
    );
    expect(resizer.ariaLabel).toContain("Resize Agent column");
    expect(resizer.getAttribute("aria-orientation")).toBe("vertical");
    expect(resizer.getAttribute("aria-valuemin")).toBe("40");
    expect(resizer.getAttribute("aria-valuenow")).toBe("100");
    const disclosure = requireElement(
      root.querySelector<HTMLButtonElement>(".event-expansion-button"),
      "Missing event disclosure",
    );
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure.getAttribute("aria-controls")).toBe(
      liveInspectionPanelId("event", "alpha:1"),
    );

    disclosure.click();

    expect(onToggle).toHaveBeenCalledWith("alpha:1", expect.any(Event));
    requireElement(
      root.querySelector<HTMLTableRowElement>(
        'tr[data-inspector-event-id="alpha:1"]',
      ),
      "Missing event row",
    ).click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps expanded event copy controls outside the collapse button", () => {
    const state = createLiveInspectionState();
    state.expandedEventIds.add("alpha:1");
    const root = mount(
      renderEventsView({
        state,
        events: [
          {
            id: "alpha:1",
            agentId: "alpha",
            type: "RUN_STARTED",
            timestamp: 1,
            payload: { runId: "run-1" },
          },
        ],
        renderIcon,
        renderJson: () =>
          html`
            <button type="button">Copy JSON</button>
          `,
        onFilterInput: () => undefined,
        onAgentChange: () => undefined,
        onTypeChange: () => undefined,
        onResetFilters: () => undefined,
        onExport: () => undefined,
        onClear: () => undefined,
        onToggle: () => undefined,
        onResizeStart: () => undefined,
        onResizeMove: () => undefined,
        onResizeEnd: () => undefined,
        onResizeKeyDown: () => undefined,
      }),
    );

    const expanded = requireElement(
      root.querySelector<HTMLElement>(".event-expanded-payload"),
      "Missing expanded event payload",
    );
    expect(expanded.querySelectorAll("button")).toHaveLength(2);
    expect(expanded.querySelector("button button")).toBeNull();
    expect(
      requireElement(
        root.querySelector<HTMLButtonElement>(".event-collapse-button"),
        "Missing event collapse button",
      ).ariaLabel,
    ).toContain("Collapse RUN_STARTED event from alpha");
    expect(
      root
        .querySelector<HTMLButtonElement>(".event-collapse-button")
        ?.getAttribute("aria-controls"),
    ).toBe(expanded.id);
  });

  it("renders capability and card toggles with native button semantics", () => {
    const state = createLiveInspectionState();
    state.contextStore = { account: { value: { plan: "pro" } } };
    state.expandedToolIds.add("alpha:search");
    state.expandedContextIds.add("account");
    const capabilities = mount(
      renderCapabilitiesView({
        available: true,
        tools: [
          {
            key: ":search",
            name: "search",
            enabled: true,
          },
        ],
        catalog: [],
        renderIcon,
        onToggleTool: () => undefined,
        onToggleCatalog: () => undefined,
      }),
    );
    const tools = mount(
      renderToolsView({
        state,
        available: true,
        tools: [
          {
            agentId: "alpha",
            name: "search",
            type: "handler",
          },
        ],
        renderIcon,
        onToggle: () => undefined,
      }),
    );
    const context = mount(
      renderContextView({
        state,
        renderIcon,
        renderJson: (value) => html`<span>${JSON.stringify(value)}</span>`,
        onToggle: () => undefined,
      }),
    );

    const capability = requireElement(
      capabilities.querySelector<HTMLButtonElement>('button[role="switch"]'),
      "Missing capability switch",
    );
    expect(capability.ariaLabel).toBe("Toggle search capability");
    expect(capability.getAttribute("aria-checked")).toBe("true");
    const toolButton = requireElement(
      tools.querySelector<HTMLButtonElement>('button[aria-expanded="true"]'),
      "Missing tool disclosure",
    );
    const contextButton = requireElement(
      context.querySelector<HTMLButtonElement>('button[aria-expanded="true"]'),
      "Missing context disclosure",
    );
    expect(toolButton.ariaLabel).toBe("Collapse tool search");
    expect(toolButton.getAttribute("aria-controls")).toBe(
      liveInspectionPanelId("tool", "alpha:search"),
    );
    expect(contextButton.ariaLabel).toBe("Collapse context account");
    expect(contextButton.getAttribute("aria-controls")).toBe(
      liveInspectionPanelId("context", "account"),
    );
    const copyJson = requireElement(
      context.querySelector<HTMLElement>(
        'cpk-inspector-copy-button[label="Copy JSON"]',
      ),
      "Missing context JSON copy control",
    );
    expect(Reflect.get(copyJson, "value")).toBe('{\n  "plan": "pro"\n}');
  });

  it("encodes arbitrary disclosure keys into stable DOM-safe panel IDs", () => {
    const first = liveInspectionPanelId("context", 'account / "primary"');
    const second = liveInspectionPanelId("context", 'account / "primary"');

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-z0-9-]+$/);
    expect(first).not.toContain("account");
  });

  it("includes agent scope in capability switch names", () => {
    const root = mount(
      renderCapabilitiesView({
        available: true,
        tools: [
          {
            key: "alpha:search",
            name: "search",
            agentId: "alpha",
            enabled: true,
          },
        ],
        catalog: [],
        renderIcon,
        onToggleTool: () => undefined,
        onToggleCatalog: () => undefined,
      }),
    );

    expect(
      root.querySelector<HTMLButtonElement>('[role="switch"]')?.ariaLabel,
    ).toBe("Toggle search capability for agent alpha");
  });

  it("uses a normal click-driven menu button for agent scope", () => {
    const state = createLiveInspectionState();
    state.contextOptions.push({ key: "alpha", label: "alpha" });
    state.selectedContext = "alpha";
    const onKeyDown = vi.fn();
    const onToggle = vi.fn();
    const root = mount(
      renderAgentScopeDropdown({
        state,
        agentsOnly: false,
        iconRail: false,
        open: true,
        renderIcon,
        onToggle,
        onSelect: () => undefined,
        onPointerEnter: () => undefined,
        onPointerLeave: () => undefined,
        onFocusIn: () => undefined,
        onFocusOut: () => undefined,
        onKeyDown,
      }),
    );
    const trigger = requireElement(
      root.querySelector<HTMLButtonElement>(
        'button[aria-label^="Select agent scope"]',
      ),
      "Missing agent scope trigger",
    );

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-controls")).toBe(AGENT_SCOPE_POPUP_ID);
    const popup = requireElement(
      root.querySelector<HTMLElement>(`#${AGENT_SCOPE_POPUP_ID}`),
      "Missing agent scope menu",
    );
    expect(popup.getAttribute("role")).toBe("menu");
    expect(popup.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2);
    expect(
      popup.querySelector('[role="menuitemradio"][aria-checked="true"]')
        ?.textContent,
    ).toContain("alpha");

    trigger.click();

    expect(onToggle).toHaveBeenCalledTimes(1);
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onKeyDown).toHaveBeenCalledWith(expect.any(KeyboardEvent));
  });

  it("does not render focusable agent options while scope is closed", () => {
    const root = mount(
      renderAgentScopeDropdown({
        state: createLiveInspectionState(),
        agentsOnly: false,
        iconRail: true,
        open: false,
        renderIcon,
        onToggle: () => undefined,
        onSelect: () => undefined,
        onPointerEnter: () => undefined,
        onPointerLeave: () => undefined,
        onFocusIn: () => undefined,
        onFocusOut: () => undefined,
        onKeyDown: () => undefined,
      }),
    );

    expect(root.querySelector(`#${AGENT_SCOPE_POPUP_ID}`)).toBeNull();
    expect(root.querySelector('[role="menuitemradio"]')).toBeNull();
  });

  it("renders agent message text without template indentation", () => {
    const root = mount(
      renderAgentsView({
        agentId: "alpha",
        status: "idle",
        stats: {
          totalEvents: 0,
          lastActivity: null,
          messages: 1,
          toolCalls: 0,
          errors: 0,
        },
        state: null,
        hasState: false,
        messages: [
          {
            id: "message-1",
            role: "user",
            contentText: "test",
            toolCalls: [],
          },
        ],
        toolError: null,
        errorBanner: html``,
        toolsSection: html``,
        eventsSection: html``,
        renderIcon,
        renderJson: () => html``,
        onViewEvents: () => undefined,
      }),
    );

    expect(root.querySelector(".whitespace-pre-wrap")?.textContent).toBe(
      "test",
    );
  });
});
