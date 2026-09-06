import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { AbstractAgent } from "@ag-ui/client";
import type { ActivityMessage } from "@ag-ui/core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  anyActivityContentSchema,
  type RenderActivityMessageConfig,
} from "../../../activity-renderer";
import { CopilotKit } from "../../../copilotkit";
import { CopilotActivity } from "../copilot-activity";
import {
  PrimaryActivityRenderer,
  SecondaryActivityRenderer,
  WildcardActivityRenderer,
} from "./activity-renderer-stubs";

const activityMessage = (
  overrides: Partial<ActivityMessage> = {},
): ActivityMessage => ({
  id: "activity-1",
  role: "activity",
  activityType: "a2ui-surface",
  content: {},
  ...overrides,
});

const renderer = (
  overrides: Partial<RenderActivityMessageConfig> = {},
): RenderActivityMessageConfig => ({
  activityType: "a2ui-surface",
  content: anyActivityContentSchema,
  component: PrimaryActivityRenderer,
  ...overrides,
});

const agent = (agentId: string) => ({ agentId }) as AbstractAgent;

async function setup(
  renderers: readonly RenderActivityMessageConfig[] = [],
  agentId: string | undefined = undefined,
  message: ActivityMessage = activityMessage(),
  initialAgent: AbstractAgent | undefined = undefined,
) {
  const rendererConfigs = signal([...renderers]);
  let currentAgent = initialAgent;
  const getAgent = vi.fn((requestedAgentId: string) =>
    currentAgent?.agentId === requestedAgentId ? currentAgent : undefined,
  );

  TestBed.configureTestingModule({
    providers: [
      {
        provide: CopilotKit,
        useValue: {
          activityMessageRenderConfigs: rendererConfigs.asReadonly(),
          getAgent,
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(CopilotActivity);
  fixture.componentRef.setInput("message", message);
  fixture.componentRef.setInput("agentId", agentId);
  await fixture.whenStable();

  return {
    element: fixture.nativeElement as HTMLElement,
    fake: {
      async setAgent(
        nextAgentId: string | undefined,
        nextAgent: AbstractAgent | undefined = undefined,
      ) {
        currentAgent = nextAgent;
        fixture.componentRef.setInput("agentId", nextAgentId);
        await fixture.whenStable();
      },
      async setMessage(nextMessage: ActivityMessage) {
        fixture.componentRef.setInput("message", nextMessage);
        await fixture.whenStable();
      },
    },
  };
}

describe("CopilotActivity", () => {
  it("renders the resolved renderer with the four renderer inputs", async () => {
    const { element } = await setup(
      [
        renderer({
          agentId: "demo-button",
          content: z.object({ operations: z.array(z.unknown()) }),
        }),
      ],
      "demo-button",
      activityMessage({ content: { operations: [] } }),
      agent("demo-button"),
    );

    const rendered = element.querySelector<HTMLElement>(
      '[data-testid="primary-activity"]',
    );
    expect(rendered).not.toBeNull();
    expect(rendered?.getAttribute("data-activity-type")).toBe("a2ui-surface");
    expect(rendered?.getAttribute("data-has-agent")).toBe("true");
    expect(rendered?.getAttribute("data-content")).toBe(
      JSON.stringify({ operations: [] }),
    );
  });

  it("leaves agent undefined when no agentId is set", async () => {
    const { element } = await setup([renderer()]);

    expect(
      element
        .querySelector('[data-testid="primary-activity"]')
        ?.getAttribute("data-has-agent"),
    ).toBe("false");
  });

  it("renders nothing and warns when the content fails to parse", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { element } = await setup(
        [
          renderer({
            content: z.object({ operations: z.array(z.unknown()) }),
          }),
        ],
        undefined,
        activityMessage({ content: { wrong: true } }),
      );

      expect(
        element.querySelector('[data-testid="primary-activity"]'),
      ).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        "Failed to parse content for activity message 'a2ui-surface':",
        expect.anything(),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("updates the renderer when the agentId changes", async () => {
    const { element, fake } = await setup(
      [
        renderer({ agentId: "agent-one" }),
        renderer({
          agentId: "agent-two",
          component: SecondaryActivityRenderer,
        }),
      ],
      "agent-one",
      activityMessage(),
      agent("agent-one"),
    );
    expect(
      element.querySelector('[data-testid="primary-activity"]'),
    ).not.toBeNull();

    await fake.setAgent("agent-two", agent("agent-two"));

    expect(
      element.querySelector('[data-testid="primary-activity"]'),
    ).toBeNull();
    expect(
      element.querySelector('[data-testid="secondary-activity"]'),
    ).not.toBeNull();
  });

  it("updates the renderer when the message changes", async () => {
    const { element, fake } = await setup([
      renderer(),
      renderer({
        activityType: "other",
        component: SecondaryActivityRenderer,
      }),
    ]);
    expect(
      element.querySelector('[data-testid="primary-activity"]'),
    ).not.toBeNull();

    await fake.setMessage(activityMessage({ activityType: "other" }));

    expect(
      element.querySelector('[data-testid="primary-activity"]'),
    ).toBeNull();
    expect(
      element.querySelector('[data-testid="secondary-activity"]'),
    ).not.toBeNull();
  });

  describe("renderer selection", () => {
    it("renders the renderer registered for the activity type", async () => {
      const { element } = await setup([
        renderer({
          activityType: "other",
          component: SecondaryActivityRenderer,
        }),
        renderer(),
      ]);

      expect(
        element.querySelector('[data-testid="primary-activity"]'),
      ).not.toBeNull();
    });

    it("prefers an agent-scoped renderer over an earlier global one", async () => {
      const { element } = await setup(
        [
          renderer({ component: SecondaryActivityRenderer }),
          renderer({ agentId: "demo-button" }),
        ],
        "demo-button",
      );

      expect(
        element.querySelector('[data-testid="primary-activity"]'),
      ).not.toBeNull();
    });

    it("falls back to the global renderer for an unmatched agent", async () => {
      const { element } = await setup(
        [
          renderer({ agentId: "other-agent" }),
          renderer({ component: SecondaryActivityRenderer }),
        ],
        "demo-button",
      );

      expect(
        element.querySelector('[data-testid="secondary-activity"]'),
      ).not.toBeNull();
    });

    it("ignores agent-scoped renderers when no agentId is given", async () => {
      const { element } = await setup([
        renderer({ agentId: "demo-button" }),
        renderer({ component: SecondaryActivityRenderer }),
      ]);

      expect(
        element.querySelector('[data-testid="secondary-activity"]'),
      ).not.toBeNull();
    });

    it("falls back to the wildcard renderer", async () => {
      const { element } = await setup(
        [renderer({ activityType: "*", component: WildcardActivityRenderer })],
        undefined,
        activityMessage({ activityType: "unregistered" }),
      );

      expect(
        element.querySelector('[data-testid="wildcard-activity"]'),
      ).not.toBeNull();
    });

    it("renders nothing when no renderer matches", async () => {
      const { element } = await setup(
        [renderer()],
        undefined,
        activityMessage({ activityType: "unregistered" }),
      );

      expect(
        element.querySelector('[data-testid="primary-activity"]'),
      ).toBeNull();
      expect(element.textContent?.trim()).toBe("");
    });
  });
});
