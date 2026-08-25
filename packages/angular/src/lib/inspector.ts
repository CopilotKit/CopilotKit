import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  DestroyRef,
  Injectable,
  InjectionToken,
  Injector,
  PLATFORM_ID,
  inject,
  isDevMode,
} from "@angular/core";
import { shouldEnableInspector } from "@copilotkit/shared";
import type { WebInspectorElement } from "@copilotkit/web-inspector";

import { COPILOT_KIT_CONFIG, type CopilotKitConfig } from "./config";
import { CopilotKit } from "./copilotkit";

export const ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE =
  new InjectionToken<boolean>("CopilotKit Inspector development mode", {
    factory: isDevMode,
  });

export type AngularInspectorOpenRequest = {
  messageId: string;
  threadId?: string;
  agentId?: string;
  menu?: "event-snippets";
  snippetId?: string;
};

export type AngularInspectorSaveRequest = {
  threadId?: string;
  agentId?: string;
} & (
  | {
      kind: "text";
      messageId: string;
      content: string;
    }
  | {
      kind: "reasoning";
      messageId: string;
      content: string;
    }
  | {
      kind: "tool-call";
      messageId: string;
      toolCallId: string;
      toolName: string;
      argsJson: string | Record<string, unknown>;
    }
  | {
      kind: "activity";
      messageId: string;
      activityType: string;
      content: unknown;
    }
);

@Injectable({ providedIn: "root" })
export class CopilotInspector {
  private readonly config = inject<CopilotKitConfig | null>(
    COPILOT_KIT_CONFIG,
    { optional: true },
  );
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isDevelopment = inject(
    ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE,
  );
  private element: WebInspectorElement | null = null;
  private ownsElement = false;
  private destroyed = false;

  readonly shouldRenderInspector = shouldEnableInspector({
    enableInspector: this.config?.enableInspector,
    isBrowser: isPlatformBrowser(this.platformId),
    isDevelopment: this.isDevelopment,
  });

  /** Whether Inspector-backed message actions should be shown. */
  readonly isInspectorEnabled = this.shouldRenderInspector;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      if (this.ownsElement) this.element?.remove();
      this.element = null;
    });

    if (this.shouldRenderInspector) {
      afterNextRender(() => void this.mount());
    }
  }

  openInspector(request: AngularInspectorOpenRequest): void {
    this.element?.openInspector?.("message_toolbar", request);
  }

  async saveEventSnippet(request: AngularInspectorSaveRequest): Promise<void> {
    try {
      const mod = await import("@copilotkit/web-inspector");
      const threadId = request.threadId ?? "inspector-snippet";
      const runId = `inspector-snippet-${Date.now()}`;
      const compiled = mod.compileChatSnippet({
        ...request,
        threadId,
        runId,
      });
      const now = new Date().toISOString();
      const snippet = {
        id: crypto.randomUUID(),
        name: compiled.name,
        recipe: compiled.recipe,
        events: compiled.events,
        createdAt: now,
        updatedAt: now,
      };
      mod.upsertEventSnippet(snippet);
      this.openInspector({
        messageId: request.messageId,
        threadId: request.threadId,
        agentId: request.agentId,
        menu: "event-snippets",
        snippetId: snippet.id,
      });
    } catch (error) {
      console.error("[CopilotKit] Could not save the event snippet.", error);
    }
  }

  private async mount(): Promise<void> {
    try {
      const mod = await import("@copilotkit/web-inspector");
      if (this.destroyed) return;

      mod.defineWebInspector?.();
      const existing = this.document.querySelector<WebInspectorElement>(
        mod.WEB_INSPECTOR_TAG,
      );
      const element =
        existing ??
        (this.document.createElement(
          mod.WEB_INSPECTOR_TAG,
        ) as WebInspectorElement);

      mod.configureWebInspectorElement(
        element,
        this.injector.get(CopilotKit).core,
      );

      if (!existing) {
        this.document.body.appendChild(element);
        this.ownsElement = true;
      }
      this.element = element;
    } catch (error) {
      console.error("Failed to load CopilotKit inspector:", error);
    }
  }
}
