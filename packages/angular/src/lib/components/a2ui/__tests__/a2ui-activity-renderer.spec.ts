import { ComponentFixture, TestBed } from "@angular/core/testing";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CopilotA2UIActivityRenderer } from "../a2ui-activity-renderer";
import { COPILOT_KIT_CONFIG } from "../../../config";
import { CopilotKit } from "../../../copilotkit";
import type { ActivityMessage } from "@ag-ui/core";

describe("CopilotA2UIActivityRenderer", () => {
  let fixture: ComponentFixture<CopilotA2UIActivityRenderer>;
  let core: {
    properties: Record<string, unknown>;
    setProperties: ReturnType<typeof vi.fn>;
    runAgent: ReturnType<typeof vi.fn>;
  };

  const message: ActivityMessage = {
    id: "activity-1",
    role: "activity",
    activityType: "a2ui-surface",
    content: {
      a2ui_operations: [{ version: "v0.9", updateComponents: {} }],
    },
  };

  beforeEach(() => {
    core = {
      properties: { existing: true },
      setProperties: vi.fn((next: Record<string, unknown>) => {
        core.properties = next;
      }),
      runAgent: vi.fn().mockResolvedValue(undefined),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CopilotA2UIActivityRenderer],
      providers: [
        {
          provide: COPILOT_KIT_CONFIG,
          useValue: {
            a2ui: {
              theme: { color: "blue" },
              catalog: { id: "catalog" },
              loadingComponent: () => null,
            },
          },
        },
        {
          provide: CopilotKit,
          useValue: { core },
        },
      ],
    });

    fixture = TestBed.createComponent(CopilotA2UIActivityRenderer);
    fixture.componentRef.setInput("activityType", "a2ui-surface");
    fixture.componentRef.setInput("content", message.content);
    fixture.componentRef.setInput("message", message);
    fixture.componentRef.setInput("agent", { agentId: "demo-button" });
  });

  it("lazy-loads web components and assigns complex values as properties", async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await customElements.whenDefined("cpk-a2ui-surface");

    const element = fixture.nativeElement.querySelector("cpk-a2ui-surface");
    const scrollWrapper = fixture.nativeElement.querySelector(
      '[data-testid="a2ui-activity-surface-scroll"]',
    ) as HTMLElement | null;

    expect(scrollWrapper).not.toBeNull();
    expect(
      scrollWrapper?.classList.contains("copilot-a2ui-surface-scroll"),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(element.operations).toEqual([
        { version: "v0.9", updateComponents: {} },
      ]),
    );
    expect(element.theme).toEqual({ color: "blue" });
    expect(element.catalog).toEqual({ id: "catalog" });
    expect(element.getAttribute("operations")).toBeNull();
    expect(element.getAttribute("theme")).toBeNull();
    expect(element.getAttribute("catalog")).toBeNull();
  });

  it("bridges a2ui-action through core.runAgent and clears a2uiAction", async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement.querySelector("cpk-a2ui-surface");
    element.dispatchEvent(
      new CustomEvent("a2ui-action", {
        detail: { userAction: { name: "confirm" } },
        bubbles: true,
      }),
    );
    await fixture.whenStable();

    expect(core.setProperties).toHaveBeenNthCalledWith(1, {
      existing: true,
      a2uiAction: { userAction: { name: "confirm" } },
    });
    expect(core.runAgent).toHaveBeenCalledWith({
      agent: { agentId: "demo-button" },
    });
    expect(core.setProperties).toHaveBeenLastCalledWith({ existing: true });
  });
});
