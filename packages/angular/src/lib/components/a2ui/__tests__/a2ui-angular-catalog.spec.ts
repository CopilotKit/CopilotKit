import { Component, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ActivityMessage } from "@ag-ui/core";
import { createAngularCatalog } from "../../../../a2ui/lib/create-catalog";
import { injectA2UIComponentContext } from "../../../../a2ui/lib/component-context";
import type { A2UIProps } from "../../../../a2ui/lib/types";
import { COPILOT_KIT_CONFIG } from "../../../config";
import { CopilotKit } from "../../../copilotkit";
import { CopilotA2UIActivityRenderer } from "../a2ui-activity-renderer";
import { toLitA2UILoadingComponent } from "../lit-surface";
import { CopilotA2UIToolRenderer } from "../a2ui-tool-renderer";

const definitions = {
  Text: { props: z.object({ text: z.string() }) },
  Button: { props: z.object({ label: z.string() }) },
};

@Component({
  selector: "test-angular-text",
  template: `
    <p data-testid="angular-text">{{ props().text }}</p>
  `,
})
class TextComponent {
  readonly props = input.required<A2UIProps<typeof definitions, "Text">>();
}

@Component({
  selector: "test-angular-button",
  template: `
    <button type="button" data-testid="angular-button" (click)="confirm()">
      {{ props().label }}
    </button>
  `,
})
class ButtonComponent {
  readonly props = input.required<A2UIProps<typeof definitions, "Button">>();
  private readonly context = injectA2UIComponentContext();

  confirm(): void {
    void this.context.dispatch({ event: { name: "confirm", context: {} } });
  }
}

@Component({
  template: `
    <span data-testid="angular-loading">{{ label }}</span>
  `,
})
class LoadingComponent {
  readonly label = "Loading";
}

const litLoading = () => "loading";

const angularCatalog = createAngularCatalog(
  definitions,
  { Text: TextComponent, Button: ButtonComponent },
  { catalogId: "copilotkit://angular-test" },
);

function createCore() {
  const core = {
    properties: { existing: true } as Record<string, unknown>,
    setProperties: vi.fn((next: Record<string, unknown>) => {
      core.properties = next;
    }),
    runAgent: vi.fn().mockResolvedValue(undefined),
  };
  return core;
}

describe("catalog kind helpers", () => {
  it("keeps Angular loading components away from the Lit renderer", () => {
    expect(toLitA2UILoadingComponent(LoadingComponent)).toBeUndefined();
    expect(toLitA2UILoadingComponent(litLoading)).toBe(litLoading);
    expect(toLitA2UILoadingComponent(undefined)).toBeUndefined();
  });
});

describe("CopilotA2UIToolRenderer with an Angular catalog", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("renders the native surface instead of the web component", async () => {
    const core = createCore();
    TestBed.configureTestingModule({
      imports: [CopilotA2UIToolRenderer],
      providers: [
        {
          provide: COPILOT_KIT_CONFIG,
          useValue: {
            a2ui: { catalog: angularCatalog, theme: { accent: "blue" } },
          },
        },
        { provide: CopilotKit, useValue: { core } },
      ],
    });
    const fixture = TestBed.createComponent(CopilotA2UIToolRenderer);
    fixture.componentRef.setInput("agent", { agentId: "demo" });
    fixture.componentRef.setInput("toolCall", {
      status: "complete",
      args: { surfaceId: "dashboard" },
      result: JSON.stringify({
        snapshot: {
          surfaceId: "dashboard",
          catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
          components: [{ id: "root", component: "Button", label: "Confirm" }],
        },
      }),
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector("cpk-a2ui-surface")).toBeNull();
    expect(
      element.querySelector(
        'copilot-a2ui-surface-outlet[data-testid="a2ui-tool-surface"] copilot-a2ui-surface',
      ),
    ).not.toBeNull();
    expect(element.querySelector("copilot-a2ui-lit-surface")).toBeNull();
    expect(element.querySelector('[data-testid="a2ui-progress"]')).toBeNull();

    const button = element.querySelector(
      '[data-testid="angular-button"]',
    ) as HTMLButtonElement;
    expect(button.textContent).toContain("Confirm");

    button.click();
    await vi.waitFor(() =>
      expect(core.runAgent).toHaveBeenCalledWith({
        agent: { agentId: "demo" },
      }),
    );
    expect(core.setProperties).toHaveBeenLastCalledWith({ existing: true });
  });
});

describe("CopilotA2UIActivityRenderer with an Angular catalog", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("reveals the surface once native rendering has produced content", async () => {
    const core = createCore();
    TestBed.configureTestingModule({
      imports: [CopilotA2UIActivityRenderer],
      providers: [
        {
          provide: COPILOT_KIT_CONFIG,
          useValue: {
            a2ui: {
              catalog: angularCatalog,
              loadingComponent: LoadingComponent,
            },
          },
        },
        { provide: CopilotKit, useValue: { core } },
      ],
    });
    const message: ActivityMessage = {
      id: "activity-1",
      role: "activity",
      activityType: "a2ui-surface",
      content: {
        a2ui_operations: [
          {
            version: "v0.9",
            updateComponents: {
              surfaceId: "dashboard",
              components: [{ id: "root", component: "Text", text: "Ready" }],
            },
          },
        ],
      },
    };
    const fixture = TestBed.createComponent(CopilotA2UIActivityRenderer);
    fixture.componentRef.setInput("activityType", "a2ui-surface");
    fixture.componentRef.setInput("content", message.content);
    fixture.componentRef.setInput("message", message);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector("cpk-a2ui-surface")).toBeNull();
    expect(
      element.querySelector("copilot-a2ui-surface-outlet copilot-a2ui-surface"),
    ).not.toBeNull();
    expect(
      element.querySelector('[data-testid="angular-text"]')?.textContent,
    ).toBe("Ready");

    const host = element.querySelector(
      '[data-testid="a2ui-activity-surface-host"]',
    ) as HTMLElement;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.getAttribute("aria-hidden")).toBe("false");
    });
    expect(element.textContent).not.toContain("Building interface");
  });
});
