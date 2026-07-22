import type { ComponentRef } from "@angular/core";
import { runInInjectionContext } from "@angular/core";

/** Render a dynamically created component after all initial inputs are set. */
export function renderDynamicComponent(component: ComponentRef<unknown>): void {
  runInInjectionContext(component.injector, () => {
    component.changeDetectorRef.detectChanges();
  });
}
