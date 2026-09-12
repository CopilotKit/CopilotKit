import {
  Component,
  TemplateRef,
  Type,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
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
  const setup = async () => {
    const fixture = TestBed.createComponent(TestHost);
    const host = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    return { fixture, host, element };
  };

  it("renders projected content or the default component", async () => {
    const { fixture, host, element } = await setup();
    expect(element.querySelector(".fallback")).not.toBeNull();

    host.defaultComponent.set(TestContent);
    await fixture.whenStable();
    expect(element.querySelector("button")?.textContent).toContain("default");
    expect(element.querySelector(".fallback")).toBeNull();
  });

  it("renders a template slot with context", async () => {
    const { fixture, host, element } = await setup();
    host.slot.set(host.template());
    host.context.set({ label: "template" });
    await fixture.whenStable();

    expect(element.querySelector(".template")?.textContent).toContain(
      "template",
    );
    expect(element.querySelector(".fallback")).toBeNull();
  });

  it("binds component inputs and outputs", async () => {
    const { fixture, host, element } = await setup();
    let selected: string | undefined;
    host.slot.set(TestContent);
    host.context.set({ label: "component" });
    host.outputs.set({ selected: (value) => (selected = value) });
    await fixture.whenStable();

    const button = element.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toContain("component");

    button.click();
    await fixture.whenStable();
    expect(selected).toBe("component");
  });
});
