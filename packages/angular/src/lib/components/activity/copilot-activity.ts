import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  inject,
  input,
} from "@angular/core";
import { NgComponentOutlet } from "@angular/common";
import type { ActivityMessage } from "@ag-ui/core";
import { CopilotKit } from "../../copilotkit";
import type { RenderActivityMessageConfig } from "../../activity-renderer";

/**
 * Headless host for a single activity message.
 *
 * Registering activity renderers is public API
 * (`provideCopilotKit({ renderActivityMessages })`), but resolving and rendering
 * them used to live inside `CopilotChatMessageView`. This component exposes that
 * rendering so a custom chat shell — or an activity hosted outside a chat
 * entirely — can render activities without reimplementing the resolution logic.
 *
 * ```html
 * <copilot-activity [message]="activityMessage" [agentId]="agentId" />
 * ```
 *
 * Resolution precedence: an agent-scoped renderer beats a global one, which
 * beats the `"*"` wildcard fallback. Renders nothing when no renderer matches or
 * the content fails to parse. `CopilotChatMessageView` uses this component
 * internally, so the built-in and custom paths share one implementation.
 */
@Component({
  selector: "copilot-activity",
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @let activityRender = resolveActivityRender(message());
    @if (activityRender) {
      <ng-container
        [ngComponentOutlet]="activityRender.component"
        [ngComponentOutletInputs]="activityRender.inputs"
      />
    }
  `,
})
export class CopilotActivity {
  readonly message = input.required<ActivityMessage>();
  readonly agentId = input<string | undefined>();

  protected readonly copilotKit = inject(CopilotKit);

  private pickActivityRenderer(
    message: ActivityMessage,
  ): RenderActivityMessageConfig | undefined {
    const agentId = this.agentId();
    const renderers = this.copilotKit.activityMessageRenderConfigs();
    const matches = renderers.filter(
      (renderer) => renderer.activityType === message.activityType,
    );

    return (
      matches.find((candidate) => candidate.agentId === agentId) ??
      matches.find((candidate) => candidate.agentId === undefined) ??
      renderers.find((candidate) => candidate.activityType === "*")
    );
  }

  protected resolveActivityRender(message: ActivityMessage) {
    const renderer = this.pickActivityRenderer(message);
    if (!renderer) return undefined;

    const parseResult = renderer.content.safeParse(message.content);
    if (parseResult.success === false) {
      console.warn(
        `Failed to parse content for activity message '${message.activityType}':`,
        parseResult.error,
      );
      return undefined;
    }

    const agentId = this.agentId();
    const agent = agentId ? this.copilotKit.getAgent(agentId) : undefined;
    return {
      component: renderer.component,
      inputs: {
        activityType: message.activityType,
        content: parseResult.data,
        message,
        agent,
      },
    };
  }
}
