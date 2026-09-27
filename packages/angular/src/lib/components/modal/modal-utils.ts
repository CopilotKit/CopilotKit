import {
  Injector,
  inject,
  reflectComponentType,
  type Provider,
  type Type,
} from "@angular/core";

import {
  COPILOT_CHAT_CONFIGURATION,
  CopilotChatConfiguration,
  provideCopilotChatConfiguration,
} from "../../chat-configuration";

/**
 * Gives a popup or sidebar a chat configuration (active thread, drawer state)
 * shared by its chat and its threads drawer: the app's, when one is in scope,
 * else one of its own. So `threadsDrawer` can switch threads without the app
 * calling `provideCopilotChatConfiguration`, as in React, where every chat
 * carries its own configuration.
 */
export function provideModalChatConfiguration(): Provider {
  return {
    provide: COPILOT_CHAT_CONFIGURATION,
    useFactory: () =>
      inject(COPILOT_CHAT_CONFIGURATION, { optional: true, skipSelf: true }) ??
      Injector.create({
        providers: provideCopilotChatConfiguration(),
        parent: inject(Injector),
      }).get(CopilotChatConfiguration),
  };
}

/**
 * Inputs a popup/sidebar forwards to its chat component. Only inputs the
 * component declares are passed, so custom chat components keep working.
 */
export function chatComponentInputs(
  component: Type<unknown>,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const declared = new Set(
    reflectComponentType(component)?.inputs.map((i) => i.templateName) ?? [],
  );
  return Object.fromEntries(
    Object.entries(inputs).filter(([name]) => declared.has(name)),
  );
}

/** Convert a finite number or non-empty CSS dimension to a safe fallback. */
export function dimensionToCss(
  value: number | string | undefined,
  fallback: number,
): string {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}px`;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return `${fallback}px`;
}

/**
 * The `threadsDrawer` input of `<copilot-popup>` / `<copilot-sidebar>`: `true`
 * for the default drawer, an object to configure it, or `false` (the default)
 * for none. The drawer opens from a launcher in the modal header as an overlay
 * panel inside the modal.
 */
export type CopilotModalThreadsDrawer =
  | boolean
  | {
      /** Agent whose threads the drawer lists. */
      agentId?: string;
      /** Accessible label and default header of the drawer. */
      label?: string;
      /** Heading of the thread list section. */
      recentLabel?: string;
      /** Page size for thread pagination. */
      limit?: number;
      /** Destination of the locked view's Upgrade button. */
      licenseUrl?: string;
    };

/** Resolves a {@link CopilotModalThreadsDrawer} to drawer settings, or `null` when off. */
export function resolveModalThreadsDrawer(
  threadsDrawer: CopilotModalThreadsDrawer | undefined,
): Exclude<CopilotModalThreadsDrawer, boolean> | null {
  if (!threadsDrawer) return null;
  return threadsDrawer === true ? {} : threadsDrawer;
}
