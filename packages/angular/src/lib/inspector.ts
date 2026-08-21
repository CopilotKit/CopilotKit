import { Injectable, Injector, inject } from "@angular/core";
import { COPILOT_KIT_CONFIG, type CopilotKitConfig } from "./config";
import { CopilotKit } from "./copilotkit";

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
    {
      optional: true,
    },
  );
  private readonly injector = inject(Injector);
  private element: {
    openInspector?: (
      source: string,
      options: AngularInspectorOpenRequest,
    ) => void;
  } | null = null;

  readonly isLocalInspectorEnabled = this.resolveEnabled();

  constructor() {
    if (this.isLocalInspectorEnabled) {
      queueMicrotask(() => {
        void this.mount();
      });
    }
  }

  openInspector(request: AngularInspectorOpenRequest): void {
    this.element?.openInspector?.("message_toolbar", request);
  }

  async saveEventSnippet(request: AngularInspectorSaveRequest): Promise<void> {
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
  }

  private resolveEnabled(): boolean {
    const flag = this.config?.showDevConsole;
    if (flag === true) {
      return true;
    }
    if (flag === "auto" && typeof window !== "undefined") {
      return (
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1"
      );
    }
    return false;
  }

  private async mount(): Promise<void> {
    if (typeof document === "undefined") {
      return;
    }
    const copilotkit = this.injector.get(CopilotKit);
    const mod = await import("@copilotkit/web-inspector");
    mod.defineWebInspector?.();
    const existing = document.querySelector(mod.WEB_INSPECTOR_TAG);
    const element = (existing ??
      document.createElement(mod.WEB_INSPECTOR_TAG)) as HTMLElement & {
      core?: unknown;
      openInspector?: (
        source: string,
        options: AngularInspectorOpenRequest,
      ) => void;
    };
    element.core = copilotkit.core;
    if (!existing) {
      document.body.appendChild(element);
    }
    this.element = element;
  }
}
