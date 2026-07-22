import { A2uiRendererService } from "@a2ui/angular/v0_9";
import type { A2uiClientAction } from "@a2ui/web_core/v0_9";
import {
  DestroyRef,
  EnvironmentInjector,
  assertInInjectionContext,
  inject,
  runInInjectionContext,
} from "@angular/core";

/** Maps an A2UI action name to the handler invoked when it is dispatched. */
export type A2UIActionHandlers = Record<
  string,
  (action: A2uiClientAction) => void
>;

/**
 * Subscribes to actions dispatched from any rendered A2UI surface and routes
 * each action to the handler registered under the action's name. Actions
 * without a registered handler are ignored.
 *
 * Handlers run in the environment injection context, so they can use
 * `inject()` to access application services. Must be called in an injection
 * context; the subscription is released when that context is destroyed.
 */
export function registerA2UIActionHandlers(handlers: A2UIActionHandlers): void {
  assertInInjectionContext(registerA2UIActionHandlers);

  const renderer = inject(A2uiRendererService);
  const destroyRef = inject(DestroyRef);
  const environmentInjector = inject(EnvironmentInjector);

  const subscription = renderer.surfaceGroup.onAction.subscribe((action) => {
    const handler = handlers[action.name];
    if (!handler) {
      return;
    }

    runInInjectionContext(environmentInjector, () => {
      handler(action);
    });
  });

  destroyRef.onDestroy(() => {
    subscription.unsubscribe();
  });
}
