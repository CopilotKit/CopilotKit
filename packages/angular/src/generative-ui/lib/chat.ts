import { NgComponentOutlet } from "@angular/common";
import {
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from "@angular/core";
import type { AbstractAgent, ActivityMessage } from "@ag-ui/client";
import {
  COPILOT_CHAT_CONFIGURATION,
  type ActivityRenderer,
  type AngularToolCall,
  type RenderActivityMessageConfig,
  type ToolRenderer,
} from "@copilotkit/angular";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_CHAT_TARGET,
  GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
} from "@copilotkit/shared";
import type {
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import type { ManagedSurface } from "@copilotkit/core/generative-ui";
import { z } from "zod";
import { GENERATIVE_UI_CONFIG } from "./config";
import { GENERATIVE_UI_RUNTIME } from "./runtime";
import { CopilotGenerativeUISurfaceView } from "./surface-view";

/** The inputs of a chat card: the default one and a `chatCard` of the config. */
export type GenerativeUIChatCardInputs = {
  surface: ManagedSurface;
  surfaceId: string;
  isStreaming: boolean;
  /**
   * Set when operations from the latest render_ui call were rejected. The
   * message is user-facing; `error.cause` holds the same list as `rejected`.
   */
  error: Error | undefined;
  /** Rejected operations from the latest render_ui call, with validator reasons. */
  rejected: GenerativeUIRejectedOperation[];
};

/**
 * Experimental. The card around a surface in the chat. Replace it with
 * `provideGenerativeUI({ chatCard })`; the replacement gets the same inputs
 * and renders the surface with `<copilot-generative-ui-surface-view>`.
 */
@Component({
  selector: "copilot-generative-ui-chat-card",
  imports: [CopilotGenerativeUISurfaceView],
  template: `
    @if (!surface().failed) {
      <copilot-generative-ui-surface-view [surface]="surface()" />
    }
    @if (error()) {
      <div role="alert" style="margin-top: 8px; font-size: 12px; color: #dc2626">
        Part of this UI couldn't be shown.
      </div>
    }
  `,
  host: {
    "[attr.data-generative-ui-chat-surface]": "surfaceId()",
    style:
      "display:block;margin:8px 0;width:100%;box-sizing:border-box;border:1px solid #e5e7eb;border-radius:12px;padding:12px",
  },
})
export class CopilotGenerativeUIChatCard {
  readonly surface = input.required<ManagedSurface>();
  readonly surfaceId = input.required<string>();
  readonly isStreaming = input(false);
  readonly error = input<Error | undefined>();
  readonly rejected = input<GenerativeUIRejectedOperation[]>([]);
}

const contentSchema = z
  .object({
    surfaceId: z.string(),
    target: z.string(),
    catalogId: z.string(),
    operations: z.array(z.any()),
    status: z.enum(["streaming", "ready", "error"]),
    rejected: z
      .array(z.object({ index: z.number(), reason: z.string() }))
      .default([]),
  })
  .passthrough();

/**
 * @internal
 * Renders a surface activity of the tool transport in the chat: it ingests
 * the operations and shows the surface in the chat card. A surface for a
 * named target renders in its `<copilot-generative-ui-surface>` instead.
 */
@Component({
  selector: "copilot-generative-ui-activity",
  imports: [NgComponentOutlet],
  template: `
    @if (card(); as card) {
      <ng-container *ngComponentOutlet="cardType; inputs: card" />
    }
  `,
})
export class CopilotGenerativeUIActivityRenderer implements ActivityRenderer<GenerativeUISurfaceContent> {
  readonly activityType = input.required<string>();
  readonly content = input.required<GenerativeUISurfaceContent>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();

  readonly #runtime = inject(GENERATIVE_UI_RUNTIME, { optional: true });
  readonly #chat = inject(COPILOT_CHAT_CONFIGURATION, { optional: true });
  protected readonly cardType =
    inject(GENERATIVE_UI_CONFIG, { optional: true })?.chatCard ??
    CopilotGenerativeUIChatCard;

  readonly #threadId = computed(
    () => this.#chat?.threadId() ?? this.agent()?.threadId,
  );

  protected readonly card = computed<GenerativeUIChatCardInputs | undefined>(
    () => {
      const runtime = this.#runtime;
      const content = this.content();
      const threadId = this.#threadId();
      if (!runtime || !threadId) return undefined;
      if (content.target !== GENERATIVE_UI_CHAT_TARGET) return undefined;
      runtime.version();
      // A surface whose createSurface was rejected shows only the error.
      const surface =
        runtime.manager.getSurface(threadId, content.surfaceId) ??
        runtime.manager.getFailedSurface(threadId, content.surfaceId);
      if (!surface) return undefined;
      // Both lists cover only the latest render_ui call (see the manager's
      // ingest). A custom card gets the detailed reasons; the default card
      // shows a generic message.
      const rejected = [...(content.rejected ?? []), ...surface.clientRejected];
      const error = rejected.length
        ? new Error(`${rejected.length} UI update(s) could not be shown`, {
            cause: rejected,
          })
        : undefined;
      return {
        surface,
        surfaceId: content.surfaceId,
        isStreaming: content.status === "streaming",
        error,
        rejected,
      };
    },
  );

  constructor() {
    effect(() => {
      const content = this.content();
      const threadId = this.#threadId();
      const agentId = this.agent()?.agentId;
      untracked(() => {
        if (this.#runtime && threadId) {
          this.#runtime.manager.ingest(threadId, agentId, content);
        }
      });
    });
  }
}

/**
 * @internal
 * Shows nothing in the chat for an agent-called function. The root reads the
 * function-call activities from the messages and runs them. This renderer
 * only keeps a wildcard ("*") activity renderer from showing them.
 */
@Component({
  selector: "copilot-generative-ui-function-call-activity",
  template: "",
})
export class CopilotGenerativeUIFunctionCallRenderer implements ActivityRenderer<unknown> {
  readonly activityType = input.required<string>();
  readonly content = input.required<unknown>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();
}

/**
 * @internal
 * Renders nothing for `render_ui`: the surface activity owns the UX.
 * Registering it still keeps a wildcard tool renderer from showing the raw
 * arguments.
 */
@Component({
  selector: "copilot-generative-ui-render-tool-call",
  template: "",
})
export class CopilotGenerativeUIRenderToolCall implements ToolRenderer<
  Record<string, unknown>
> {
  readonly toolCall =
    input.required<AngularToolCall<Record<string, unknown>>>();
}

/** The activity renderers that `provideGenerativeUI` adds to the chat. */
export const generativeUIActivityRenderers: RenderActivityMessageConfig[] = [
  {
    activityType: GENERATIVE_UI_ACTIVITY_TYPE,
    content: contentSchema as unknown as RenderActivityMessageConfig["content"],
    component:
      CopilotGenerativeUIActivityRenderer as unknown as RenderActivityMessageConfig["component"],
  },
  {
    activityType: GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
    content: z.unknown(),
    component: CopilotGenerativeUIFunctionCallRenderer,
  },
];
