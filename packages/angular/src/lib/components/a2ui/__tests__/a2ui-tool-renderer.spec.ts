import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { CopilotA2UIToolRenderer } from "../a2ui-tool-renderer";
import {
  AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
  type RenderA2UIArgs,
} from "../a2ui-tool-types";
import { COPILOT_KIT_CONFIG } from "../../../config";
import type { AngularToolCall } from "../../../tools";

type A2UITestSurfaceElement = HTMLElement & {
  operations?: Array<Record<string, unknown>>;
  theme?: Record<string, unknown>;
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

  it("renders complete A2UI snapshot tool results as a web component surface", async () => {
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
    await customElements.whenDefined("cpk-a2ui-surface");

    const surface = fixture.nativeElement.querySelector(
      "cpk-a2ui-surface",
    ) as A2UITestSurfaceElement | null;
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
    expect(surface?.operations).toEqual([
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
    expect(surface?.theme).toEqual({ color: "blue" });
    expect(surface?.getAttribute("operations")).toBeNull();
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
    await customElements.whenDefined("cpk-a2ui-surface");

    const surface = fixture.nativeElement.querySelector(
      "cpk-a2ui-surface",
    ) as A2UITestSurfaceElement | null;

    expect(surface).not.toBeNull();
    expect(surface?.operations?.[0]).toMatchObject({
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

    const surface = fixture.nativeElement.querySelector(
      "cpk-a2ui-surface",
    ) as A2UITestSurfaceElement | null;

    expect(surface).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="a2ui-progress"]'),
    ).toBeTruthy();
  });

  it("renders complete A2UI operation tool results as a web component surface", async () => {
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
    await customElements.whenDefined("cpk-a2ui-surface");

    const surface = fixture.nativeElement.querySelector(
      "cpk-a2ui-surface",
    ) as A2UITestSurfaceElement | null;

    expect(surface?.operations).toEqual(operations);
  });
});
