import {
  Component,
  TemplateRef,
  Type,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { CopilotSlot } from "../copilot-slot";
import { SlotOutputs } from "../slot.types";

@Component({
  selector: "test-content",
  template: `
    <button (click)="selected.emit(label())">{{ label() }}</button>
  `,
})
class TestContent {
  readonly label = input("default");
  readonly selected = output<string>();
}

@Component({
  imports: [CopilotSlot],
  template: `
    <ng-template #template let-label="label">
      <span class="template">{{ label }}</span>
    </ng-template>
    <copilot-slot
      [slot]="slot()"
      [defaultComponent]="defaultComponent()"
      [context]="context()"
      [outputs]="outputs()"
    >
      <span class="fallback">fallback</span>
    </copilot-slot>
  `,
})
class TestHost {
  readonly template = viewChild.required<TemplateRef<unknown>>("template");
  readonly slot = signal<TemplateRef<unknown> | Type<unknown> | undefined>(
    undefined,
  );
  readonly defaultComponent = signal<Type<unknown> | undefined>(undefined);
  readonly context = signal<Record<string, unknown> | undefined>(undefined);
  readonly outputs = signal<SlotOutputs | undefined>(undefined);
}

describe("CopilotSlot", () => {
  let fixture: ComponentFixture<TestHost>;
  let host: TestHost;
  let element: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(TestHost);
    host = fixture.componentInstance;
    element = fixture.nativeElement;
  });

  it("renders projected content or the default component", () => {
    fixture.detectChanges();
    expect(element.querySelector(".fallback")).not.toBeNull();

    host.defaultComponent.set(TestContent);
    fixture.detectChanges();
    expect(element.querySelector("button")?.textContent).toContain("default");
    expect(element.querySelector(".fallback")).toBeNull();
  });

  it("renders a template slot with context", () => {
    fixture.detectChanges();
    host.slot.set(host.template());
    host.context.set({ label: "template" });
    fixture.detectChanges();

    expect(element.querySelector(".template")?.textContent).toContain(
      "template",
    );
    expect(element.querySelector(".fallback")).toBeNull();
  });

  it("binds component inputs and outputs", () => {
    let selected: string | undefined;
    host.slot.set(TestContent);
    host.context.set({ label: "component" });
    host.outputs.set({ selected: (value) => (selected = value) });
    fixture.detectChanges();

    const button = element.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toContain("component");

    button.click();
    expect(selected).toBe("component");
  });
});
