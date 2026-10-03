import { Component, computed, effect, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { FakeRuntime, provideCopilotKitFake } from "../../../../testing";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { anyActivityContentSchema } from "../../../activity-renderer";
import type { RenderActivityMessageConfig } from "../../../activity-renderer";
import { CopilotActivity } from "../copilot-activity";
import {
  JsonActivityRenderer,
  PrimaryActivityRenderer,
  primaryActivityRendererSchema,
  ProgressActivityRenderer,
  progressActivityRendererSchema,
  WildcardActivityRenderer,
} from "./activity-renderer-stubs";
import { injectAgentStore } from "../../../agent";

describe("CopilotActivity", () => {
  @Component({
    template: `
      <div>
        @for (message of messages(); track message) {
          <copilot-activity [agentId]="agentId()" [message]="message" />
        }
      </div>
    `,
    imports: [CopilotActivity],
  })
  class CopilotActivityTestComponent {
    protected readonly agentId = input(DEFAULT_AGENT_ID);
    protected readonly agentStore = injectAgentStore(this.agentId);

    protected readonly messages = computed(() =>
      this.agentStore()
        .messages()
        .filter((m) => m.role === "activity"),
    );

    constructor() {
      effect(() => this.agentStore().agent.runAgent());
    }
  }

  const setup = async (
    renderers: RenderActivityMessageConfig[] = [
      {
        component: PrimaryActivityRenderer,
        activityType: "*",
        content: z.object({ message: z.string() }),
      },
    ],
    agentIds: readonly string[] = [DEFAULT_AGENT_ID],
    initialAgentId: string = DEFAULT_AGENT_ID,
    component = CopilotActivityTestComponent,
  ) => {
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKitFake({
          agentIds,
          renderActivityMessages: renderers,
        }),
      ],
    });
    const fixture = TestBed.createComponent(component);

    if (initialAgentId !== DEFAULT_AGENT_ID) {
      fixture.componentRef.setInput("agentId", initialAgentId);
    }
    const fakeRuntime = TestBed.inject(FakeRuntime);
    return { fakeRuntime, fixture };
  };

  it("should render the message", async () => {
    const { fakeRuntime } = await setup();
    fakeRuntime.emitActivityMessage({ message: "Hello, world!" }, "message");

    await expect.poll(queryPrimaryTest()).toContain("Hello, world!");
  });

  it("should render the progress", async () => {
    const { fakeRuntime } = await setup([
      {
        component: ProgressActivityRenderer,
        activityType: "progress",
        content: progressActivityRendererSchema,
      },
    ]);

    const messageId = crypto.randomUUID();

    fakeRuntime.emitActivityMessage(
      { completed: 1, total: 10, status: "running" },
      "progress",
      messageId,
    );

    await expect.poll(queryProgressTest()).toContain("1/10 running");

    fakeRuntime.emitActivityMessage(
      { completed: 10, total: 10, status: "completed" },
      "progress",
      messageId,
    );

    await expect.poll(queryProgressTest()).toContain("10/10 completed");
  });

  it("renders nothing and warns when the content fails to parse", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { fakeRuntime } = await setup([
      {
        component: PrimaryActivityRenderer,
        activityType: "*",
        content: z.object({ message: z.string() }),
      },
    ]);

    fakeRuntime.emitActivityMessage({ errorCode: "Invalid Content" }, "");

    await vi.waitUntil(() => warn.mock.calls.length > 0);
    expect(queryPrimaryTest()()).toBeUndefined();
  });

  it("switches renderer when agentId changes", async () => {
    const { fakeRuntime, fixture } = await setup(
      [
        {
          component: PrimaryActivityRenderer,
          activityType: "message",
          content: z.object({ message: z.string() }),
          agentId: "agent-one",
        },
        {
          component: JsonActivityRenderer,
          activityType: "message",
          content: anyActivityContentSchema,
          agentId: "agent-two",
        },
      ],
      ["agent-one", "agent-two"],
      "agent-one",
    );

    fakeRuntime.emitActivityMessage(
      { message: "Hello, world!" },
      "message",
      undefined,
      "agent-one",
    );
    await expect.poll(queryPrimaryTest()).toContain("Hello, world!");

    fixture.componentRef.setInput("agentId", "agent-two");

    fakeRuntime.emitActivityMessage(
      { message: "Hello, world!" },
      "message",
      undefined,
      "agent-two",
    );
    await expect.poll(queryJsonTest()).toContain('"message": "Hello, world!"');
    expect(queryPrimaryTest()()).toBeUndefined();
  });

  it("updates the renderer when the message changes", async () => {
    const { fakeRuntime } = await setup([
      {
        component: PrimaryActivityRenderer,
        activityType: "message",
        content: z.object({ message: z.string() }),
      },
      {
        component: ProgressActivityRenderer,
        activityType: "progress",
        content: progressActivityRendererSchema,
      },
    ]);

    const messageId = crypto.randomUUID();
    fakeRuntime.emitActivityMessage(
      { completed: 1, total: 10, status: "running" },
      "progress",
      messageId,
    );
    await expect.poll(queryProgressTest()).toContain("1/10 running");

    fakeRuntime.emitActivityMessage(
      { message: "Hello, world!" },
      "message",
      messageId,
    );
    await expect.poll(queryPrimaryTest()).toContain("Hello, world!");
    expect(queryProgressTest()()).toBeUndefined();
  });

  describe("renderer selection", () => {
    it("renders the renderer registered for the activity type", async () => {
      const { fakeRuntime } = await setup([
        {
          activityType: "main",
          component: PrimaryActivityRenderer,
          content: primaryActivityRendererSchema,
        },
        {
          activityType: "progress",
          component: ProgressActivityRenderer,
          content: progressActivityRendererSchema,
        },
      ]);

      fakeRuntime.emitActivityMessage({ message: "Hello, world!" }, "main");
      await expect.poll(queryPrimaryTest()).toContain("Hello, world!");
    });

    it("prefers an agent-scoped renderer over an earlier global one", async () => {
      const { fakeRuntime } = await setup([
        {
          component: ProgressActivityRenderer,
          activityType: "main",
          content: anyActivityContentSchema,
        },
        {
          component: PrimaryActivityRenderer,
          activityType: "main",
          agentId: DEFAULT_AGENT_ID,
          content: primaryActivityRendererSchema,
        },
      ]);

      fakeRuntime.emitActivityMessage({ message: "Hello, world!" }, "main");

      await expect.poll(queryPrimaryTest()).toContain("Hello, world!");
    });

    it("falls back to the global renderer for an unmatched agent", async () => {
      const { fakeRuntime } = await setup([
        {
          component: ProgressActivityRenderer,
          activityType: "main",
          agentId: "other-agent",
          content: anyActivityContentSchema,
        },
        {
          component: PrimaryActivityRenderer,
          activityType: "main",
          content: primaryActivityRendererSchema,
        },
      ]);

      fakeRuntime.emitActivityMessage({ message: "Hello, world!" }, "main");

      await expect.poll(queryPrimaryTest()).toContain("Hello, world!");
      expect(queryProgressTest()()).toBeUndefined();
    });

    it("ignores agent-scoped renderers when no agentId is given", async () => {
      @Component({
        template: `
          <div>
            @for (message of messages(); track message) {
              <copilot-activity [message]="message" />
            }
          </div>
        `,
        imports: [CopilotActivity],
      })
      class CopilotActivityTestComponentWithouAgentID extends CopilotActivityTestComponent {}

      const { fakeRuntime } = await setup(
        [
          {
            agentId: "demo-button",
            component: ProgressActivityRenderer,
            activityType: "main",
            content: progressActivityRendererSchema,
          },
          {
            component: PrimaryActivityRenderer,
            activityType: "main",
            content: primaryActivityRendererSchema,
          },
        ],
        ["demo-button", DEFAULT_AGENT_ID],
        DEFAULT_AGENT_ID,
        CopilotActivityTestComponentWithouAgentID,
      );

      fakeRuntime.emitActivityMessage({ message: "Hello, world!" }, "main");

      await expect
        .poll(() => document.querySelector('[data-testid="primary-activity"]'))
        .not.toBeNull();
    });

    it("falls back to the wildcard renderer", async () => {
      const { fakeRuntime } = await setup([
        {
          activityType: "*",
          component: PrimaryActivityRenderer,
          content: primaryActivityRendererSchema,
        },
        {
          activityType: "main",
          component: WildcardActivityRenderer,
          content: anyActivityContentSchema,
        },
      ]);

      fakeRuntime.emitActivityMessage(
        { message: "Hello, world!" },
        "unregistered",
      );

      await expect
        .poll(() => document.querySelector('[data-testid="primary-activity"]'))
        .not.toBeNull();
    });
  });
});

function queryPrimaryTest() {
  return () =>
    document.querySelector(`[data-testid="primary-activity"]`)?.textContent;
}

function queryProgressTest() {
  return () =>
    document.querySelector(`[data-testid="progress-activity"]`)?.textContent;
}

function queryJsonTest() {
  return () =>
    document.querySelector(`[data-testid="json-activity"]`)?.textContent;
}
