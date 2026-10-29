import { Component, computed, inject, input } from "@angular/core";
import {
  backgroundColor,
  borderColor,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type { followUpItem } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { GENERATIVE_UI_NODE_CONTEXT } from "../../node-context";
import { GENERATIVE_UI_RUNTIME } from "../../runtime";
import { GenerativeUIStyles } from "../../styles";
import type { GenerativeUIEventProp } from "../context";
import type { StyleMap } from "../style";
import { PILL_BUTTON, SECONDARY_SM } from "./styles";

/** The event a FollowUp pill sends when the model bound no onFollowUp. */
const FOLLOW_UP_EVENT = "follow_up";

type FollowUpItem = z.output<typeof followUpItem>;

/**
 * Suggested next prompts as pills. A FollowUp always sends: when the model
 * bound `onFollowUp`, that binding runs. Else the pill forwards a
 * `follow_up` event with its message, which the engine turns into a visible
 * user message with that text.
 */
@Component({
  selector: "div[copilotGenerativeUIFollowUp]",
  template: `
    @if (title()) {
      <span [style]="titleStyle">{{ title() }}</span>
    }
    <div [style]="{ display: 'flex', 'flex-wrap': 'wrap', gap: gap }">
      @for (entry of entries(); track $index) {
        <button
          type="button"
          data-a2ui-input=""
          (click)="$event.stopPropagation(); send(entry.message)"
          [style]="pillStyle"
        >
          {{ entry.label }}
        </button>
      }
    </div>
  `,
  host: {
    "data-a2ui-follow-up": "",
    "data-a2ui-std": "",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUIFollowUp {
  readonly items = input<FollowUpItem[]>();
  readonly title = input<string>();
  readonly onFollowUp = input<GenerativeUIEventProp<{ message: string }>>();

  readonly #runtime = inject(GENERATIVE_UI_RUNTIME, { optional: true });
  readonly #node = inject(GENERATIVE_UI_NODE_CONTEXT, { optional: true });

  protected readonly entries = computed(() =>
    (this.items() ?? []).map((item) => {
      const entry = typeof item === "string" ? { label: item } : item;
      return { label: entry.label, message: entry.message ?? entry.label };
    }),
  );
  protected readonly gap = spacing(2);
  // React renders nothing without items; the host hides itself instead.
  protected readonly style = computed<StyleMap>(() =>
    this.entries().length === 0
      ? { display: "none" }
      : { display: "flex", "flex-direction": "column", gap: spacing(2) },
  );
  protected readonly titleStyle = SECONDARY_SM;
  protected readonly pillStyle: StyleMap = {
    ...PILL_BUTTON,
    border: `1px solid ${borderColor("default")}`,
    background: backgroundColor("surface"),
    color: textColor("default"),
  };

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }

  protected send(message: string) {
    const onFollowUp = this.onFollowUp();
    if (onFollowUp) {
      onFollowUp({ message });
      return;
    }
    const runtime = this.#runtime;
    const node = this.#node;
    if (!runtime || !node) return;
    const surface = runtime.manager.getSurfaceByKey(node.surfaceKey);
    void runtime.forwardEvent(
      {
        name: FOLLOW_UP_EVENT,
        surfaceId: node.surfaceId,
        componentId: node.componentId,
        userMessage: message,
        context: { message },
      },
      surface?.agentId,
    );
  }
}
