import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from "@angular/core";
import {
  Check,
  Circle,
  CopilotIcon,
  Loader2,
  X,
  type CopilotIconData,
} from "../icons/copilot-icon";
import type { ToolCallRowStatus } from "./tool-call-render-context";
import { cn } from "../../utils";

/**
 * Height transition between closed and its content's height, like React's
 * `Collapsible`. Closed content stays rendered (so its state survives) but is
 * inert.
 * @internal
 */
@Component({
  selector: "div[copilotCollapsible]",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: "cpk-collapsible",
    "[style.grid-template-rows]": "open() ? '1fr' : '0fr'",
    "[attr.inert]": "open() ? null : ''",
  },
  template: `
    <div class="cpk-collapsible-content"><ng-content /></div>
  `,
})
export class CopilotCollapsible {
  readonly open = input(false, { alias: "copilotCollapsible" });
}

/** A status icon for a call or group: spinner, check, cross or circle. */
@Component({
  selector: "copilot-tool-call-status-icon",
  imports: [CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { style: "display: contents" },
  template: `
    <copilot-icon [img]="icon()" [iconClass]="iconClass()" />
  `,
})
export class CopilotToolCallStatusIcon {
  readonly status = input.required<ToolCallRowStatus>();
  protected readonly icon = computed<CopilotIconData>(
    () =>
      ({ running: Loader2, done: Check, failed: X, stopped: Circle })[
        this.status()
      ],
  );
  protected readonly iconClass = computed(() =>
    cn(
      "cpk-tool-call-status-icon",
      this.status() === "running" && "cpk-tool-call-status-icon-running",
      this.status() === "failed" && "cpk-tool-call-status-icon-failed",
    ),
  );
}
