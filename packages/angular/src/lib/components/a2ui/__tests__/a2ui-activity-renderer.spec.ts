import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CopilotA2UIActivityRenderer } from "../a2ui-activity-renderer";
import { COPILOT_KIT_CONFIG } from "../../../config";
import { CopilotKit } from "../../../copilotkit";
import { ActivityMessage } from "@ag-ui/core";
import { basicCatalog } from "../../../../a2ui/lib/basic/catalog";
import { CopilotA2UISurface } from "../../../../a2ui/lib/surface";

describe("CopilotA2UIActivityRenderer", () => {
  let fixture: ComponentFixture<CopilotA2UIActivityRenderer>;
  let core: {
    properties: Record<string, unknown>;
    setProperties: ReturnType<typeof vi.fn>;
    runAgent: ReturnType<typeof vi.fn>;
  };

  const operation = {
    version: "v0.9",
    updateComponents: {
      surfaceId: "default",
      components: [{ id: "root", component: "Text", text: "Hello" }],
    },
  };
  const message: ActivityMessage = {
    id: "activity-1",
    role: "activity",
    activityType: "a2ui-surface",
    content: { a2ui_operations: [operation] },
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
            a2ui: { catalog: basicCatalog },
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

  afterEach(() => fixture.destroy());

  function surfaceComponent(): CopilotA2UISurface {
    return fixture.debugElement.query(By.directive(CopilotA2UISurface))
      .componentInstance;
  }

  it("passes its operations to the catalog's surface in the scroll wrapper", async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const surface = surfaceComponent();
    const scrollWrapper = fixture.nativeElement.querySelector(
      '[data-testid="a2ui-activity-surface-scroll"]',
    ) as HTMLElement | null;

    expect(scrollWrapper).not.toBeNull();
    expect(
      scrollWrapper?.classList.contains("copilot-a2ui-surface-scroll"),
    ).toBe(true);
    expect(surface.operations()).toEqual([operation]);
  });

  it("bridges surface actions through core.runAgent and clears a2uiAction", async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const userAction = {
      name: "confirm",
      surfaceId: "default",
      sourceComponentId: "button",
      timestamp: "2026-01-01T00:00:00.000Z",
      context: {},
    };
    surfaceComponent().action.emit({ userAction });
    await fixture.whenStable();

    expect(core.setProperties).toHaveBeenNthCalledWith(1, {
      existing: true,
      a2uiAction: { userAction },
    });
    expect(core.runAgent).toHaveBeenCalledWith({
      agent: { agentId: "demo-button" },
    });
    expect(core.setProperties).toHaveBeenLastCalledWith({ existing: true });
  });

  it("renders building and server-driven retry lifecycle states in place", () => {
    fixture.componentRef.setInput("content", {
      status: "building",
      progressTokens: 97,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Building interface");
    expect(fixture.nativeElement.textContent).toContain("97 tokens");
    expect(
      fixture.nativeElement.querySelector("copilot-a2ui-surface"),
    ).toBeNull();

    fixture.componentRef.setInput("content", {
      status: "retrying",
      attempt: 2,
      maxAttempts: 3,
      errors: [{ code: "missing_required_prop" }],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Retrying generation");
    expect(fixture.nativeElement.textContent).toContain("2/3 attempts");
    expect(fixture.nativeElement.textContent).toContain(
      "missing_required_prop",
    );
  });

  it("renders failed recovery state with safely collapsed diagnostics", () => {
    fixture.componentRef.setInput("content", {
      status: "failed",
      error: "invalid component",
      attempts: [{ attempt: 1, ok: false }],
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("Couldn't generate");
    const details = fixture.nativeElement.querySelector("details");
    expect(details).not.toBeNull();
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.textContent).toContain("invalid component");
  });

  it("keeps the surface mounted offscreen until its renderable content is ready", async () => {
    fixture.componentRef.setInput("content", {
      status: "building",
      a2ui_operations: [
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "dashboard",
            components: [{ id: "root", component: "Text", text: "Dashboard" }],
          },
        },
      ],
    });
    fixture.detectChanges();

    const surface = fixture.nativeElement.querySelector("copilot-a2ui-surface");
    const host = fixture.nativeElement.querySelector(
      '[data-testid="a2ui-activity-surface-host"]',
    );
    expect(surface).not.toBeNull();
    expect(host.getAttribute("aria-hidden")).toBe("true");
    expect(fixture.nativeElement.textContent).toContain("Building interface");

    await fixture.whenStable();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.getAttribute("aria-hidden")).toBe("false");
    });
    expect(fixture.nativeElement.textContent).not.toContain(
      "Building interface",
    );
  });

  it("keeps the same surface when the activity content changes", async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const original = fixture.nativeElement.querySelector(
      "copilot-a2ui-surface",
    );

    fixture.componentRef.setInput("content", {
      a2ui_operations: [
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "one",
            components: [{ id: "root", component: "Text", text: "Updated" }],
          },
        },
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector("copilot-a2ui-surface")).toBe(
      original,
    );
  });

  it("logs the surface's render errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fixture.componentRef.setInput("content", {
      a2ui_operations: [
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "broken",
            components: [{ component: "Text" }],
          },
        },
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "[A2UI Angular] render error:",
        expect.objectContaining({ message: expect.any(String) }),
      ),
    );
    warn.mockRestore();
  });
});
