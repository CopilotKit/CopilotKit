import { provideMarkdownRenderer } from "@a2ui/angular/v0_9";
import { NgComponentOutlet } from "@angular/common";
import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import {
  CopilotA2UIAngularActivityRenderer,
  a2uiAngularActivityRendererConfig,
  a2uiSurfaceContentSchema,
} from "../a2ui-angular-activity-renderer";
import { provideA2UIAngularRenderer } from "../provide-a2ui-angular-renderer";
import { installConstructableStyleSheetSupport } from "./constructable-stylesheet-support";

installConstructableStyleSheetSupport();

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

function inputsFor(id: string): Record<string, unknown> {
  const content = {
    operations: [
      {
        version: "v0.9",
        createSurface: { surfaceId: id, catalogId: BASIC_CATALOG_ID },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: id,
          components: [
            { id: "root", component: "Column", children: ["t"] },
            { id: "t", component: "Text", text: `hi ${id}` },
          ],
        },
      },
    ],
  };
  return {
    activityType: "a2ui-surface",
    content,
    message: { id, role: "activity", activityType: "a2ui-surface", content },
    agent: undefined,
  };
}

@Component({
  imports: [NgComponentOutlet],
  template: `
    @for (item of items(); track item.id) {
      <ng-container *ngComponentOutlet="renderer; inputs: item.inputs" />
    }
  `,
})
class HostComponent {
  readonly renderer = CopilotA2UIAngularActivityRenderer;
  readonly items = signal<{ id: string; inputs: Record<string, unknown> }[]>(
    [],
  );
}

async function settle(fixture: {
  whenStable: () => Promise<unknown>;
  detectChanges: () => void;
}) {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 30));
  fixture.detectChanges();
  await fixture.whenStable();
}

describe("CopilotA2UIAngularActivityRenderer", () => {
  it("renders an A2UI surface from an a2ui-surface activity message", async () => {
    TestBed.configureTestingModule({
      providers: [
        provideA2UIAngularRenderer(),
        provideMarkdownRenderer(async (markdown) => markdown),
      ],
    });

    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.items.set([
      { id: "surf-1", inputs: inputsFor("surf-1") },
    ]);
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain("hi surf-1");
  });

  it("renders a second surface appended after the first in the shared renderer", async () => {
    TestBed.configureTestingModule({
      providers: [
        provideA2UIAngularRenderer(),
        provideMarkdownRenderer(async (markdown) => markdown),
      ],
    });

    const fixture = TestBed.createComponent(HostComponent);
    const host = fixture.componentInstance;

    host.items.set([{ id: "surf-1", inputs: inputsFor("surf-1") }]);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain("hi surf-1");

    host.items.update((current) => [
      ...current,
      { id: "surf-2", inputs: inputsFor("surf-2") },
    ]);
    fixture.detectChanges();
    await settle(fixture);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain("hi surf-1");
    expect(text).toContain("hi surf-2");
  });

  it("accepts a2ui-surface content with an operations array", () => {
    const parsed = a2uiSurfaceContentSchema.safeParse({
      operations: [{ version: "v0.9", createSurface: { surfaceId: "s" } }],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a2ui-surface content without operations", () => {
    const parsed = a2uiSurfaceContentSchema.safeParse({ wrong: true });

    expect(parsed.success).toBe(false);
  });

  it("is preconfigured for the a2ui-surface activity type", () => {
    expect(a2uiAngularActivityRendererConfig.activityType).toBe("a2ui-surface");
    expect(a2uiAngularActivityRendererConfig.component).toBe(
      CopilotA2UIAngularActivityRenderer,
    );
  });
});
