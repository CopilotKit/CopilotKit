import type { ComponentRef } from "@angular/core";

/** Render a dynamically created component after all initial inputs are set. */
export function renderDynamicComponent(component: ComponentRef<unknown>): void {
  component.changeDetectorRef.detectChanges();
}
