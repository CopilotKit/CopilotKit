import { Component, computed, input } from "@angular/core";
import type { AbstractAgent, ActivityMessage } from "@ag-ui/client";
import type { ActivityRenderer } from "../../../activity-renderer";
import { JsonPipe } from "@angular/common";
import z from "zod";

export const primaryActivityRendererSchema = z.object({
  message: z.string(),
});

/**
 * Minimal activity renderers used to exercise CopilotActivity. Each surfaces the
 * four inputs it receives so DOM-level tests can assert on
 * them, and carries a distinct `data-testid` so tests can tell which renderer the
 * resolution logic picked.
 */
@Component({
  selector: "primary-activity-renderer",
  template: `
    <div
      data-testid="primary-activity"
      [attr.data-activity-type]="activityType()"
      [attr.data-has-agent]="agent() ? 'true' : 'false'"
      [attr.data-content]="contentJson()"
    >
      {{ content()?.message }}
    </div>
  `,
})
export class PrimaryActivityRenderer implements ActivityRenderer {
  readonly activityType = input.required<string>();
  readonly content = input.required<{ message: string }>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();
  protected readonly contentJson = computed(() =>
    JSON.stringify(this.content()),
  );
}

export const progressActivityRendererSchema = z.object({
  completed: z.number(),
  total: z.number(),
  status: z.string(),
});

export type ProgressActivityRendererSchema = z.infer<
  typeof progressActivityRendererSchema
>;

@Component({
  selector: "progress-activity-renderer",
  template: `
    @let content = this.content();
    <div data-testid="progress-activity">
      {{ content.completed }}/{{ content.total }} {{ content.status }}
    </div>
  `,
})
export class ProgressActivityRenderer implements ActivityRenderer {
  readonly activityType = input.required<string>();
  readonly content = input.required<ProgressActivityRendererSchema>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();
}

@Component({
  selector: "json-activity-renderer",
  template: `
    <div data-testid="json-activity">
      {{ content() | json }}
    </div>
  `,
  imports: [JsonPipe],
})
export class JsonActivityRenderer implements ActivityRenderer {
  readonly activityType = input.required<string>();
  readonly content = input.required<unknown>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();
}

@Component({
  selector: "wildcard-activity-renderer",
  template: `
    <div data-testid="wildcard-activity"></div>
  `,
})
export class WildcardActivityRenderer implements ActivityRenderer {
  readonly activityType = input.required<string>();
  readonly content = input.required<unknown>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();
}
