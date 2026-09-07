import { Component, signal } from "@angular/core";
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
  const renderers = signal<RenderActivityMessageConfig[]>([]);
  const getAgent = vi.fn();

  const render = (message: ActivityMessage, agentId?: string) => {
    const fixture = TestBed.createComponent(ActivityHostComponent);
    fixture.componentInstance.message = message;
    fixture.componentInstance.agentId = agentId;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

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
  });

  it("renders the resolved renderer with the four renderer inputs", () => {
    renderers.set([
      {
        activityType: "a2ui-surface",
        agentId: "demo-button",
        content: z.object({ operations: z.array(z.unknown()) }),
        component: PrimaryActivityRenderer,
      },
    ]);
    getAgent.mockReturnValue({ agentId: "demo-button" });

    const host = render(
      activityMessage({ content: { operations: [] } }),
      "demo-button",
    );

    const rendered = host.querySelector<HTMLElement>(
      '[data-testid="primary-activity"]',
    );
    expect(rendered).not.toBeNull();
    expect(rendered?.getAttribute("data-activity-type")).toBe("a2ui-surface");
    expect(rendered?.getAttribute("data-has-agent")).toBe("true");
    expect(rendered?.getAttribute("data-content")).toBe(
      JSON.stringify({ operations: [] }),
    );
    expect(getAgent).toHaveBeenCalledWith("demo-button");
  });

  it("leaves agent undefined when no agentId is set", () => {
    renderers.set([
      {
        activityType: "a2ui-surface",
        content: anyActivityContentSchema,
        component: PrimaryActivityRenderer,
      },
    ]);

    const host = render(activityMessage());

    expect(
      host
        .querySelector('[data-testid="primary-activity"]')
        ?.getAttribute("data-has-agent"),
    ).toBe("false");
    expect(getAgent).not.toHaveBeenCalled();
  });

  it("renders the wildcard renderer for unregistered activity types", () => {
    renderers.set([
      {
        activityType: "*",
        content: anyActivityContentSchema,
        component: WildcardActivityRenderer,
      },
    ]);

    const host = render(activityMessage({ activityType: "unregistered" }));

    expect(
      host.querySelector('[data-testid="wildcard-activity"]'),
    ).not.toBeNull();
  });

  it("renders nothing and warns when the content fails to parse", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderers.set([
      {
        activityType: "a2ui-surface",
        content: z.object({ operations: z.array(z.unknown()) }),
        component: PrimaryActivityRenderer,
      },
    ]);

    const host = render(activityMessage({ content: { wrong: true } }));

    expect(host.querySelector('[data-testid="primary-activity"]')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "Failed to parse content for activity message 'a2ui-surface':",
      expect.anything(),
    );
    warn.mockRestore();
  });

  it("renders nothing when no renderer matches", () => {
    const host = render(activityMessage({ activityType: "unregistered" }));

    expect(host.querySelector('[data-testid="primary-activity"]')).toBeNull();
    expect((host.textContent ?? "").trim()).toBe("");
  });
});
