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

  TestBed.configureTestingModule({
    providers: [
      {
        provide: CopilotKit,
        useValue: {
          activityMessageRenderConfigs: rendererConfigs.asReadonly(),
          getAgent: (requestedAgentId: string) =>
            currentAgent?.agentId === requestedAgentId
              ? currentAgent
              : undefined,
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(CopilotActivity);
  fixture.componentRef.setInput("message", message);
  fixture.componentRef.setInput("agentId", agentId);
  await fixture.whenStable();

  return {
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
    await setup(
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

    await expect
      .poll(() =>
        document.querySelector<HTMLElement>('[data-testid="primary-activity"]'),
      )
      .not.toBeNull();

    const rendered = document.querySelector<HTMLElement>(
      '[data-testid="primary-activity"]',
    );
    expect(rendered?.getAttribute("data-activity-type")).toBe("a2ui-surface");
    expect(rendered?.getAttribute("data-has-agent")).toBe("true");
    expect(rendered?.getAttribute("data-content")).toBe(
      JSON.stringify({ operations: [] }),
    );
  });

  it("leaves agent undefined when no agentId is set", async () => {
    await setup([renderer()]);

    await expect
      .poll(() =>
        document
          .querySelector('[data-testid="primary-activity"]')
          ?.getAttribute("data-has-agent"),
      )
      .toBe("false");
  });

  it("renders nothing and warns when the content fails to parse", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await setup(
        [
          renderer({
            content: z.object({ operations: z.array(z.unknown()) }),
          }),
        ],
        undefined,
        activityMessage({ content: { wrong: true } }),
      );

      await vi.waitUntil(() => warn.mock.calls.length > 0);
      expect(
        document.querySelector('[data-testid="primary-activity"]'),
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
    const { fake } = await setup(
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
    await expect
      .poll(() => document.querySelector('[data-testid="primary-activity"]'))
      .not.toBeNull();

    await fake.setAgent("agent-two", agent("agent-two"));

    await expect
      .poll(() => document.querySelector('[data-testid="secondary-activity"]'))
      .not.toBeNull();
    expect(
      document.querySelector('[data-testid="primary-activity"]'),
    ).toBeNull();
  });

  it("updates the renderer when the message changes", async () => {
    const { fake } = await setup([
      renderer(),
      renderer({
        activityType: "other",
        component: SecondaryActivityRenderer,
      }),
    ]);
    await expect
      .poll(() => document.querySelector('[data-testid="primary-activity"]'))
      .not.toBeNull();

    await fake.setMessage(activityMessage({ activityType: "other" }));

    await expect
      .poll(() => document.querySelector('[data-testid="secondary-activity"]'))
      .not.toBeNull();
    expect(
      document.querySelector('[data-testid="primary-activity"]'),
    ).toBeNull();
  });

  describe("renderer selection", () => {
    it("renders the renderer registered for the activity type", async () => {
      await setup([
        renderer({
          activityType: "other",
          component: SecondaryActivityRenderer,
        }),
        renderer(),
      ]);

      await expect
        .poll(() => document.querySelector('[data-testid="primary-activity"]'))
        .not.toBeNull();
    });

    it("prefers an agent-scoped renderer over an earlier global one", async () => {
      await setup(
        [
          renderer({ component: SecondaryActivityRenderer }),
          renderer({ agentId: "demo-button" }),
        ],
        "demo-button",
      );

      await expect
        .poll(() => document.querySelector('[data-testid="primary-activity"]'))
        .not.toBeNull();
    });

    it("falls back to the global renderer for an unmatched agent", async () => {
      await setup(
        [
          renderer({ agentId: "other-agent" }),
          renderer({ component: SecondaryActivityRenderer }),
        ],
        "demo-button",
      );

      await expect
        .poll(() =>
          document.querySelector('[data-testid="secondary-activity"]'),
        )
        .not.toBeNull();
    });

    it("ignores agent-scoped renderers when no agentId is given", async () => {
      await setup([
        renderer({ agentId: "demo-button" }),
        renderer({ component: SecondaryActivityRenderer }),
      ]);

      await expect
        .poll(() =>
          document.querySelector('[data-testid="secondary-activity"]'),
        )
        .not.toBeNull();
    });

    it("falls back to the wildcard renderer", async () => {
      await setup(
        [renderer({ activityType: "*", component: WildcardActivityRenderer })],
        undefined,
        activityMessage({ activityType: "unregistered" }),
      );

      await expect
        .poll(() => document.querySelector('[data-testid="wildcard-activity"]'))
        .not.toBeNull();
    });

    it("renders nothing when no renderer matches", async () => {
      await setup(
        [renderer()],
        undefined,
        activityMessage({ activityType: "unregistered" }),
      );

      await expect
        .poll(() => document.querySelector("copilot-activity"))
        .toBeNull();
      expect(
        document.querySelector('[data-testid="primary-activity"]'),
      ).toBeNull();
    });
  });
});
