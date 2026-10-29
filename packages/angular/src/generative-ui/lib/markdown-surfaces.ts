import { NgComponentOutlet } from "@angular/common";
import { Component, computed, inject, input } from "@angular/core";
import type { Type } from "@angular/core";
import {
  COPILOT_CHAT_CONFIGURATION,
  CopilotChatAssistantMessageRenderer,
} from "@copilotkit/angular";
import { splitA2UIMarkdown } from "@copilotkit/core";
import { getMarkdownSurfaceSource } from "@copilotkit/core/generative-ui";
import type {
  ManagedSurface,
  MarkdownFenceBlock,
} from "@copilotkit/core/generative-ui";
import { GENERATIVE_UI_ROOT_ID } from "@copilotkit/shared";
import type { GenerativeUIRejectedOperation } from "@copilotkit/shared";
import type { GenerativeUIChatCardInputs } from "./chat";
import { GENERATIVE_UI_CONFIG } from "./config";
import { GENERATIVE_UI_RUNTIME } from "./runtime";
import type { GenerativeUIRuntime } from "./runtime";
import { GenerativeUIStyles } from "./styles";
import { CopilotGenerativeUISurfaceView } from "./surface-view";

const FADE_STYLE_ID = "a2ui-markdown-fade";
/**
 * Components fade in as they stream: each element that appears under a
 * markdown surface runs the keyframes once on mount. The renderer keeps
 * the components per id, so an element that is already there never
 * animates again. SVG internals are left out: a chart library re-creates
 * its nodes on each render. The fade runs under reduced motion too,
 * because it moves nothing.
 */
const FADE_CSS = [
  "@keyframes a2ui-fade-in{from{opacity:0}}",
  "[data-a2ui-markdown-surface] .a2ui-surface *:not(svg):not(svg *){animation:a2ui-fade-in .35s ease-out backwards}",
].join("\n");

/**
 * Experimental. The default wrapper of a chat surface in the markdown
 * transport. It draws no box: a surface sits in the flow of the reply like
 * a paragraph, and a Card draws its own box when it is interactive. A
 * rejected operation gets one line. `provideGenerativeUI({ chatCard })`
 * replaces it, for both transports.
 */
@Component({
  selector: "copilot-generative-ui-markdown-chat-surface",
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
    "[attr.data-a2ui-markdown-surface]": "surfaceId()",
    style:
      "position:relative;margin:16px 0;display:flex;width:100%;min-width:0;max-width:100%;flex-direction:column",
  },
})
export class CopilotGenerativeUIMarkdownChatSurface {
  readonly surface = input.required<ManagedSurface>();
  readonly surfaceId = input.required<string>();
  readonly isStreaming = input(false);
  readonly error = input<Error | undefined>();
  readonly rejected = input<GenerativeUIRejectedOperation[]>([]);

  constructor() {
    inject(GenerativeUIStyles).ensure(FADE_STYLE_ID, FADE_CSS);
  }
}

type Part =
  | { kind: "markdown"; key: string; text: string }
  | { kind: "surface"; key: string; inputs: GenerativeUIChatCardInputs };

/**
 * One chat surface of a fence, or nothing until the surface has its root
 * component, so a half-streamed fence shows no empty card.
 */
function surfacePart(
  runtime: GenerativeUIRuntime,
  threadId: string,
  surfaceId: string,
): Part | undefined {
  // A surface whose createSurface was rejected shows only the error.
  const surface =
    runtime.manager.getSurface(threadId, surfaceId) ??
    runtime.manager.getFailedSurface(threadId, surfaceId);
  const root = surface?.model.componentsModel.get(GENERATIVE_UI_ROOT_ID);
  if (!surface || (!root && !surface.failed)) return undefined;
  const rejected = [...surface.serverRejected, ...surface.clientRejected];
  const error = rejected.length
    ? new Error(`${rejected.length} UI update(s) could not be shown`, {
        cause: rejected,
      })
    : undefined;
  return {
    kind: "surface",
    key: surfaceId,
    inputs: {
      surface,
      surfaceId,
      isStreaming: surface.status === "streaming",
      error,
      rejected,
    },
  };
}

/**
 * Experimental. Renders an assistant message of the markdown transport.
 * Prose renders as markdown. In place of each ```a2ui fence:
 *
 * - the fence that created a chat surface renders that surface (and the
 *   prose lifted out of it) in the chat wrapper;
 * - every other fence renders nothing: a fence that updates the surface of
 *   an earlier fence, or a fence for a named target, which
 *   `<copilot-generative-ui-surface id>` renders.
 *
 * `provideGenerativeUI({ transport: "markdown" })` makes it the markdown
 * renderer of `<copilot-chat-assistant-message>`. The inputs are the
 * `AssistantMessageMarkdownRendererContext`.
 */
@Component({
  selector: "copilot-generative-ui-markdown-surfaces",
  imports: [CopilotChatAssistantMessageRenderer, NgComponentOutlet],
  template: `
    @for (part of parts(); track part.key) {
      @switch (part.kind) {
        @case ("markdown") {
          <copilot-chat-assistant-message-renderer [content]="part.text" />
        }
        @case ("surface") {
          <ng-container *ngComponentOutlet="cardType; inputs: part.inputs" />
        }
      }
    }
  `,
})
export class CopilotGenerativeUIMarkdownSurfaces {
  /** The text of the assistant message, complete or still streaming. */
  readonly content = input("");
  /** The id of the message. The fences of the message are found by it. */
  readonly messageId = input<string>();
  /** True while the message streams. */
  readonly isStreaming = input(false);

  readonly #runtime = inject(GENERATIVE_UI_RUNTIME);
  readonly #chat = inject(COPILOT_CHAT_CONFIGURATION, { optional: true });
  protected readonly cardType: Type<unknown> =
    inject(GENERATIVE_UI_CONFIG, { optional: true })?.chatCard ??
    CopilotGenerativeUIMarkdownChatSurface;

  protected readonly parts = computed<Part[]>(() => {
    const runtime = this.#runtime;
    runtime.version();
    const messageId = this.messageId();
    // The fences are found by the message id, so without one they stay
    // code, as in React's MarkdownRenderer.
    if (messageId === undefined) {
      return [{ kind: "markdown", key: "md", text: this.content() }];
    }
    const segments = splitA2UIMarkdown(this.content());
    const threadId =
      this.#chat?.threadId() ?? runtime.manager.getActiveThread();
    const source = getMarkdownSurfaceSource(runtime);
    const parts: Part[] = [];
    segments.forEach((segment, index) => {
      if (segment.type === "markdown") {
        parts.push({
          kind: "markdown",
          key: `md-${index}`,
          text: segment.text,
        });
        return;
      }
      const blocks: MarkdownFenceBlock[] | undefined = threadId
        ? source.getFenceBlocks(threadId, messageId, segment.index)
        : undefined;
      if (!threadId || !blocks) return;
      // Keys follow the surfaces, so a surface keeps its element when prose
      // splits off around it during streaming.
      let surfaceCount = 0;
      for (const block of blocks) {
        if (block.kind === "markdown") {
          parts.push({
            kind: "markdown",
            key: `md-${index}-${surfaceCount}`,
            text: block.markdown,
          });
          continue;
        }
        surfaceCount++;
        const part = surfacePart(runtime, threadId, block.surfaceId);
        if (part) parts.push(part);
      }
    });
    return parts;
  });
}
