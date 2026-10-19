import { Component, input } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { A2UIProps } from "../../../../a2ui/lib/types";
import { createAngularCatalog } from "../../../../a2ui/lib/create-catalog";
import { injectA2UIComponentContext } from "../../../../a2ui/lib/component-context";
import { CopilotKit } from "../../../copilotkit";
import { CopilotA2UIToolRenderer } from "../a2ui-tool-renderer";
import {
  AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
  RenderA2UIArgs,
} from "../a2ui-tool-types";
import { COPILOT_KIT_CONFIG } from "../../../config";
import { AngularToolCall } from "../../../tools";

/** Records what the outlet passes to a catalog's surface. */
@Component({ selector: "test-a2ui-surface", template: "" })
class TestSurface {
  readonly operations = input<readonly unknown[]>([]);
  readonly catalog = input<unknown>();
  readonly theme = input<Record<string, unknown>>();
  readonly loadingComponent = input<unknown>();
}

@Component({ selector: "test-a2ui-loading", template: "{{ label }}" })
class TestLoading {
  protected readonly label = "Loading";
}

const testCatalog = {
  id: "copilotkit://test",
  components: new Map(),
  surfaceComponent: TestSurface,
};

function setToolCall(
  fixture: ComponentFixture<CopilotA2UIToolRenderer>,
  toolCall: AngularToolCall<RenderA2UIArgs>,
): void {
  fixture.componentRef.setInput("toolCall", toolCall);
  fixture.detectChanges();
}

describe("CopilotA2UIToolRenderer", () => {
  let fixture: ComponentFixture<CopilotA2UIToolRenderer>;

  function findSurface(): TestSurface | undefined {
    return fixture.debugElement.query(By.directive(TestSurface))
      ?.componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CopilotA2UIToolRenderer],
      providers: [
        {
          provide: COPILOT_KIT_CONFIG,
          useValue: {
            a2ui: {
              theme: { color: "blue" },
              catalog: testCatalog,
              loadingComponent: TestLoading,
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(CopilotA2UIToolRenderer);
  });

  it("shows progress while render_a2ui is streaming sparse arguments", () => {
    setToolCall(fixture, {
      status: "in-progress",
      args: { surfaceId: "dashboard" },
      result: undefined,
    });

    expect(
      fixture.nativeElement.querySelector('[data-testid="a2ui-progress"]'),
    ).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain("Building interface");
  });

  it("hides progress once the streamed A2UI surface has enough components", () => {
    setToolCall(fixture, {
      status: "in-progress",
      args: {
        components: [
          { id: "root", component: "Column" },
          { id: "title", component: "Text" },
          { id: "card", component: "Card" },
        ],
      },
      result: undefined,
    });

    expect(
      fixture.nativeElement.querySelector('[data-testid="a2ui-progress"]'),
    ).toBeNull();
  });

  it("hides progress when the tool call is complete", () => {
    setToolCall(fixture, {
      status: "complete",
      args: { surfaceId: "dashboard" },
      result: "done",
    });

    expect(
      fixture.nativeElement.querySelector('[data-testid="a2ui-progress"]'),
    ).toBeNull();
  });

  it("renders complete A2UI snapshot tool results with the catalog's surface", async () => {
    setToolCall(fixture, {
      status: "complete",
      args: { surfaceId: "a2ui-dashboard" },
      result: JSON.stringify({
        success: true,
        snapshot: {
          surfaceId: "a2ui-dashboard",
          catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
          data: { settings: { automation: true, performance: 72 } },
          components: [
            { id: "root", component: "Card", child: "title" },
            {
              id: "title",
              component: "Text",
              text: "Operations Dashboard",
              variant: "h2",
            },
          ],
        },
      }),
    });
    await fixture.whenStable();

    const surface = findSurface();
    const scrollWrapper = fixture.nativeElement.querySelector(
      '[data-testid="a2ui-tool-surface-scroll"]',
    ) as HTMLElement | null;

    expect(surface).not.toBeNull();
    expect(scrollWrapper).not.toBeNull();
    expect(
      scrollWrapper?.classList.contains("copilot-a2ui-surface-scroll"),
    ).toBe(true);
    expect(
      fixture.nativeElement.querySelector('[data-testid="a2ui-progress"]'),
    ).toBeNull();
    expect(surface?.operations()).toEqual([
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "a2ui-dashboard",
          catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
          theme: {},
        },
      },
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "a2ui-dashboard",
          path: "/",
          value: { settings: { automation: true, performance: 72 } },
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "a2ui-dashboard",
          components: [
            { id: "root", component: "Card", child: "title" },
            {
              id: "title",
              component: "Text",
              text: "Operations Dashboard",
              variant: "h2",
            },
          ],
        },
      },
    ]);
    expect(surface?.theme()).toEqual({ color: "blue" });
    expect(surface?.catalog()).toBe(testCatalog);
    expect(surface?.loadingComponent()).toBe(TestLoading);
  });

  it("renders AGUISendStateSnapshot results containing an A2UI snapshot", async () => {
    setToolCall(fixture, {
      name: AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
      status: "complete",
      args: {
        snapshot: {
          surfaceId: "a2ui-dashboard",
          components: [],
        },
      },
      result: JSON.stringify({
        success: true,
        snapshot: {
          surfaceId: "a2ui-dashboard",
          catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
          data: { enabled: true },
          components: [
            { id: "root", component: "Card", child: "title" },
            {
              id: "title",
              component: "Text",
              text: "Operations Dashboard",
              variant: "h2",
            },
          ],
        },
      }),
    });
    await fixture.whenStable();

    const surface = findSurface();

    expect(surface).not.toBeNull();
    expect(surface?.operations()[0]).toMatchObject({
      createSurface: {
        surfaceId: "a2ui-dashboard",
      },
    });
    expect(fixture.nativeElement.textContent).not.toContain(
      "AGUISendStateSnapshot",
    );
  });

  it("keeps AGUISendStateSnapshot args in progress until the result is complete", async () => {
    setToolCall(fixture, {
      name: AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
      status: "in-progress",
      args: {
        snapshot: {
          surfaceId: "a2ui-dashboard",
          catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
          components: [
            { id: "root", component: "Card", child: "title" },
            {
              id: "title",
              component: "Text",
              text: "Streaming Dashboard",
              variant: "h2",
            },
          ],
        },
      },
      result: undefined,
    });

    const surface = findSurface();

    expect(surface).toBeUndefined();
    expect(
      fixture.nativeElement.querySelector('[data-testid="a2ui-progress"]'),
    ).toBeTruthy();
  });

  it("renders complete A2UI operation tool results with the catalog's surface", async () => {
    const operations = [
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "dashboard",
          components: [{ id: "root", component: "Text", text: "Dashboard" }],
        },
      },
    ];

    setToolCall(fixture, {
      status: "complete",
      args: { surfaceId: "dashboard" },
      result: JSON.stringify({ a2ui_operations: operations }),
    });
    await fixture.whenStable();

    const surface = findSurface();

    expect(surface?.operations()).toEqual(operations);
  });
});

const buttonDefinitions = {
  Button: { props: z.object({ label: z.string() }) },
};

@Component({
  selector: "test-angular-button",
  template: `
    <button type="button" data-testid="angular-button" (click)="confirm()">
      {{ props().label }}
    </button>
  `,
})
class ButtonComponent {
  readonly props =
    input.required<A2UIProps<typeof buttonDefinitions, "Button">>();
  private readonly context = injectA2UIComponentContext();

  confirm(): void {
    void this.context.dispatch({ event: { name: "confirm", context: {} } });
  }
}

describe("CopilotA2UIToolRenderer with a real catalog", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("renders the catalog's components and sends their actions to the agent", async () => {
    const core = {
      properties: { existing: true } as Record<string, unknown>,
      setProperties: vi.fn((next: Record<string, unknown>) => {
        core.properties = next;
      }),
      runAgent: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CopilotA2UIToolRenderer],
      providers: [
        {
          provide: COPILOT_KIT_CONFIG,
          useValue: {
            a2ui: {
              catalog: createAngularCatalog(buttonDefinitions, {
                Button: ButtonComponent,
              }),
            },
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
