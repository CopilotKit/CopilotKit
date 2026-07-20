import { A2uiRendererService, SurfaceComponent } from "@a2ui/angular/v0_9";
import type { A2uiMessage } from "@a2ui/web_core/v0_9";
import type { AbstractAgent, ActivityMessage } from "@ag-ui/client";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
} from "@angular/core";
import type {
  ActivityRenderer,
  RenderActivityMessageConfig,
} from "@copilotkit/angular";
import { z } from "zod";

/**
 * Content schema for `activityType: "a2ui-surface"` activity messages: the
 * batch of A2UI protocol operations that describe the rendered surface.
 */
export const a2uiSurfaceContentSchema = z.object({
  operations: z.array(z.custom<A2uiMessage>()),
});

/** Parsed content of an `a2ui-surface` activity message. */
export type A2UISurfaceContent = z.infer<typeof a2uiSurfaceContentSchema>;

/**
 * Activity renderer for `a2ui-surface` snapshots based on the official A2UI
 * Angular renderer (`@a2ui/angular`).
 *
 * The emitted operations are fed into the shared {@link A2uiRendererService},
 * so all surfaces of a conversation share one surface group and one catalog
 * configuration. Because the official Angular renderer resolves catalog
 * entries to Angular component classes, custom components for custom catalogs
 * can be written as plain Angular components and registered via
 * `provideA2UIAngularRenderer`.
 */
@Component({
  selector: "copilot-a2ui-angular-activity-renderer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SurfaceComponent],
  template: `
    @let surface = surfaceId();
    @if (surface) {
      <a2ui-v09-surface [surfaceId]="surface" />
    }
  `,
})
export class CopilotA2UIAngularActivityRenderer implements ActivityRenderer<A2UISurfaceContent> {
  readonly activityType = input.required<string>();
  readonly content = input.required<A2UISurfaceContent>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();

  private readonly renderer = inject(A2uiRendererService);

  protected readonly surfaceId = computed(() =>
    getRenderedSurfaceId(this.content().operations),
  );

  constructor() {
    effect(() => {
      this.renderer.processMessages(this.content().operations);
    });
  }
}

/**
 * Ready-to-register render config for `a2ui-surface` activity messages. Pass
 * it to `provideCopilotKit({ renderActivityMessages: [...] })` to render A2UI
 * surfaces with the official Angular renderer.
 */
export const a2uiAngularActivityRendererConfig: RenderActivityMessageConfig<A2UISurfaceContent> =
  {
    activityType: "a2ui-surface",
    content: a2uiSurfaceContentSchema,
    component: CopilotA2UIAngularActivityRenderer,
  };

function getRenderedSurfaceId(operations: A2uiMessage[]): string | null {
  for (const operation of operations) {
    if ("createSurface" in operation && operation.createSurface.surfaceId) {
      return operation.createSurface.surfaceId;
    }

    if (
      "updateComponents" in operation &&
      operation.updateComponents.surfaceId
    ) {
      return operation.updateComponents.surfaceId;
    }

    if ("updateDataModel" in operation && operation.updateDataModel.surfaceId) {
      return operation.updateDataModel.surfaceId;
    }
  }
  return null;
}
