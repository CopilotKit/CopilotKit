import {
  Component,
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ActivityMessage } from "@ag-ui/core";
import { CopilotActivity } from "../copilot-activity";
import { CopilotKit } from "../../../copilotkit";
import {
  anyActivityContentSchema,
  type RenderActivityMessageConfig,
} from "../../../activity-renderer";
import {
  PrimaryActivityRenderer,
  SecondaryActivityRenderer,
  WildcardActivityRenderer,
} from "./activity-renderer-stubs";

@Component({
  imports: [CopilotActivity],
  template: `
    <copilot-activity [message]="message" [agentId]="agentId" />
  `,
})
class ActivityHostComponent {
  message!: ActivityMessage;
  agentId: string | undefined = undefined;
}

type ActivityTestHarness = CopilotActivity & {
  agentId: () => string | undefined;
  resolveActivityRender: (
    message: ActivityMessage,
  ) => { component: unknown; inputs: Record<string, unknown> } | undefined;
};

const activityMessage = (
  overrides: Partial<ActivityMessage> = {},
): ActivityMessage => ({
  id: "activity-1",
  role: "activity",
  activityType: "a2ui-surface",
  content: {},
  ...overrides,
});

describe("CopilotActivity", () => {
  let injector: EnvironmentInjector;
  let harness: ActivityTestHarness;
  const renderers = signal<RenderActivityMessageConfig[]>([]);
  const getAgent = vi.fn();

  beforeEach(() => {
    TestBed.resetTestingModule();
    renderers.set([]);
    getAgent.mockReset();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CopilotKit,
          useValue: {
            activityMessageRenderConfigs: renderers.asReadonly(),
            getAgent,
          },
        },
      ],
    });
    injector = TestBed.inject(EnvironmentInjector);
    harness = runInInjectionContext(
      injector,
      () => new CopilotActivity(),
    ) as unknown as ActivityTestHarness;
    harness.agentId = () => undefined;
  });

  it("resolves a registered renderer and forwards the four inputs", () => {
    const message = activityMessage({ content: { operations: [] } });
    const agent = { agentId: "demo-button" };
    renderers.set([
      {
        activityType: "a2ui-surface",
        content: z.object({ operations: z.array(z.unknown()) }),
        component: PrimaryActivityRenderer,
      },
    ]);
    getAgent.mockReturnValue(agent);
    harness.agentId = () => "demo-button";

    const result = harness.resolveActivityRender(message);

    expect(result?.component).toBe(PrimaryActivityRenderer);
    expect(result?.inputs).toEqual({
      activityType: "a2ui-surface",
      content: { operations: [] },
      message,
      agent,
    });
  });

  it("prefers an agent-scoped renderer over a global one registered before it", () => {
    // Regression: the global renderer is registered first in the array. The
    // agent-scoped one must still win for a matching agentId.
    renderers.set([
      {
        activityType: "a2ui-surface",
        content: z.object({}),
        component: SecondaryActivityRenderer,
      },
      {
        activityType: "a2ui-surface",
        agentId: "demo-button",
        content: z.object({}),
        component: PrimaryActivityRenderer,
      },
    ]);
    harness.agentId = () => "demo-button";

    const result = harness.resolveActivityRender(activityMessage());

    expect(result?.component).toBe(PrimaryActivityRenderer);
  });

  it("falls back to the wildcard renderer when no activity type matches", () => {
    const message = activityMessage({
      activityType: "unregistered",
      content: { anything: true },
    });
    renderers.set([
      {
        activityType: "a2ui-surface",
        content: z.object({}),
        component: SecondaryActivityRenderer,
      },
      {
        activityType: "*",
        content: anyActivityContentSchema,
        component: WildcardActivityRenderer,
      },
    ]);

    const result = harness.resolveActivityRender(message);

    expect(result?.component).toBe(WildcardActivityRenderer);
    expect(result?.inputs.content).toEqual({ anything: true });
  });

  it("renders nothing and warns when the content fails to parse", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const message = activityMessage({ content: { wrong: true } });
    renderers.set([
      {
        activityType: "a2ui-surface",
        content: z.object({ operations: z.array(z.unknown()) }),
        component: PrimaryActivityRenderer,
      },
    ]);

    const result = harness.resolveActivityRender(message);

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "Failed to parse content for activity message 'a2ui-surface':",
      expect.anything(),
    );
    warn.mockRestore();
  });

  it("leaves agent undefined when no agentId is set", () => {
    renderers.set([
      {
        activityType: "a2ui-surface",
        content: z.object({}),
        component: PrimaryActivityRenderer,
      },
    ]);

    const result = harness.resolveActivityRender(activityMessage());

    expect(result?.inputs.agent).toBeUndefined();
    expect(getAgent).not.toHaveBeenCalled();
  });

  it("renders the resolved renderer standalone via ngComponentOutlet", () => {
    const message = activityMessage({ content: { operations: [] } });
    const agent = { agentId: "demo-button" };
    renderers.set([
      {
        activityType: "a2ui-surface",
        agentId: "demo-button",
        content: z.object({ operations: z.array(z.unknown()) }),
        component: PrimaryActivityRenderer,
      },
    ]);
    getAgent.mockReturnValue(agent);

    const fixture = TestBed.createComponent(ActivityHostComponent);
    fixture.componentInstance.message = message;
    fixture.componentInstance.agentId = "demo-button";
    fixture.detectChanges();

    const rendered = fixture.nativeElement.querySelector<HTMLElement>(
      '[data-testid="primary-activity"]',
    );
    expect(rendered).not.toBeNull();
    expect(rendered?.getAttribute("data-activity-type")).toBe("a2ui-surface");
    expect(rendered?.getAttribute("data-has-agent")).toBe("true");
    expect(rendered?.getAttribute("data-content")).toBe(
      JSON.stringify({ operations: [] }),
    );
  });

  it("renders nothing when no renderer matches", () => {
    renderers.set([]);

    const fixture = TestBed.createComponent(ActivityHostComponent);
    fixture.componentInstance.message = activityMessage({
      activityType: "unregistered",
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid="primary-activity"]'),
    ).toBeNull();
    expect((fixture.nativeElement.textContent ?? "").trim()).toBe("");
  });
});
