import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
} from "@angular/core";
import { NgComponentOutlet } from "@angular/common";
import type { ActivityMessage } from "@ag-ui/core";
import type { AbstractAgent } from "@ag-ui/client";
import { CopilotKit } from "../../copilotkit";
import type { RenderActivityMessageConfig } from "../../activity-renderer";
import { pickActivityRenderer } from "./pick-activity-renderer";

interface ActivityRender {
  component: RenderActivityMessageConfig["component"];
  inputs: {
    activityType: string;
    content: unknown;
    message: ActivityMessage;
    agent: AbstractAgent | undefined;
  };
}

/**
 * Renders a single activity message through the activity renderer registered
 * for its `activityType` (see `provideCopilotKit({ renderActivityMessages })`
 * and `registerRenderActivityMessage`).
 *
 * This is the activity counterpart of `RenderToolCalls` and the Angular
 * equivalent of React's `useRenderActivityMessage()`: `CopilotChatMessageView`
 * uses it for the `activity` role, and custom chat shells or non-chat surfaces
 * (dashboards, side panels) can host an activity with it directly instead of
 * instantiating the whole message view.
 *
 * ```html
 * <copilot-activity [message]="activityMessage" [agentId]="agentId" />
 * ```
 *
 * Renders nothing when no renderer matches or when the renderer's content
 * schema rejects the message content (a warning is logged in that case).
 */
@Component({
  selector: "copilot-activity",
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @let render = resolveRender(message());
    @if (render) {
      <ng-container *ngComponentOutlet="render.component; inputs: render.inputs" />
    }
  `,
})
export class CopilotActivity {
  readonly #copilotKit = inject(CopilotKit);

  /** The activity message to render. */
  readonly message = input.required<ActivityMessage>();
  /** Agent scope used for renderer resolution and passed to the renderer. */
  readonly agentId = input<string | undefined>();

  protected resolveRender(
    message: ActivityMessage,
  ): ActivityRender | undefined {
    const agentId = this.agentId();
    const renderer = pickActivityRenderer({
      activityType: message.activityType,
      agentId,
      renderers: this.#copilotKit.activityMessageRenderConfigs(),
    });
    if (!renderer) return undefined;

    const parseResult = renderer.content.safeParse(message.content);
    if (parseResult.success === false) {
      console.warn(
        `Failed to parse content for activity message '${message.activityType}':`,
        parseResult.error,
      );
      return undefined;
    }

    return {
      component: renderer.component,
      inputs: {
        activityType: message.activityType,
        content: parseResult.data,
        message,
        agent: agentId ? this.#copilotKit.getAgent(agentId) : undefined,
      },
    };
  }
}
