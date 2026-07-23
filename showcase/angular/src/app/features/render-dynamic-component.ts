import type {
  ComponentRef,
  Injector,
  Type,
  ViewContainerRef,
} from "@angular/core";
import { EnvironmentInjector, runInInjectionContext } from "@angular/core";

/** Create a standalone component while its provider factories may call inject. */
export function createDynamicComponent<T>(
  container: ViewContainerRef,
  component: Type<T>,
  options?: { injector?: Injector },
): ComponentRef<T> {
  const creationOptions = {
    ...options,
    environmentInjector: container.injector.get(EnvironmentInjector),
  };
  return runInInjectionContext(options?.injector ?? container.injector, () =>
    container.createComponent(component, creationOptions),
  );
}

/** Render a dynamically created component after all initial inputs are set. */
export function renderDynamicComponent(component: ComponentRef<unknown>): void {
  runInInjectionContext(component.injector, () => {
    component.changeDetectorRef.detectChanges();
  });
}
