import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import type { AbstractAgent, ActivityMessage } from "@ag-ui/client";
import type { ActivityRenderer } from "../../../activity-renderer";

/**
 * Minimal activity renderers used to exercise CopilotActivity. Each surfaces the
 * four inputs it receives so both DOM-level and white-box tests can assert on
 * them, and carries a distinct `data-testid` so tests can tell which renderer the
 * resolution logic picked.
 */
@Component({
  selector: "primary-activity-renderer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      data-testid="primary-activity"
      [attr.data-activity-type]="activityType()"
      [attr.data-has-agent]="agent() ? 'true' : 'false'"
      [attr.data-content]="contentJson()"
    ></div>
  `,
})
export class PrimaryActivityRenderer implements ActivityRenderer {
  readonly activityType = input.required<string>();
  readonly content = input.required<unknown>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();
  protected readonly contentJson = computed(() =>
    JSON.stringify(this.content()),
  );
}

@Component({
  selector: "secondary-activity-renderer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="secondary-activity"></div>
  `,
})
export class SecondaryActivityRenderer implements ActivityRenderer {
  readonly activityType = input.required<string>();
  readonly content = input.required<unknown>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();
}

@Component({
  selector: "wildcard-activity-renderer",
  changeDetection: ChangeDetectionStrategy.OnPush,
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
