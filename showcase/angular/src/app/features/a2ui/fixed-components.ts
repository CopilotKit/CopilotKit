import { Component, input } from "@angular/core";
import { CopilotGenerativeUIChildren } from "@copilotkit/angular/generative-ui";
import type { GenerativeUIChildren } from "@copilotkit/angular/generative-ui";

import { a2uiHost as host } from "./a2ui-host";

@Component({
  selector: "showcase-a2ui-flight-card",
  imports: [CopilotGenerativeUIChildren],
  host,
  template: `
    <article data-testid="a2ui-fixed-card" class="a2ui-flight-card">
      <ng-container *copilotGenerativeUIChildren="child()" />
    </article>
  `,
})
export class FixedCardComponent {
  readonly child = input<GenerativeUIChildren>();
}

@Component({
  selector: "showcase-a2ui-title",
  host,
  template: ` <h3>{{ text() }}</h3> `,
})
export class FixedTitleComponent {
  readonly text = input.required<string>();
}

@Component({
  selector: "showcase-a2ui-airport",
  host,
  template: ` <strong class="a2ui-airport">{{ code() }}</strong> `,
})
export class FixedAirportComponent {
  readonly code = input.required<string>();
}

@Component({
  selector: "showcase-a2ui-arrow",
  host,
  template: ` <span class="a2ui-arrow" aria-hidden="true">→</span> `,
})
export class FixedArrowComponent {}

@Component({
  selector: "showcase-a2ui-airline-badge",
  host,
  template: ` <span class="a2ui-airline">{{ name() }}</span> `,
})
export class FixedAirlineBadgeComponent {
  readonly name = input.required<string>();
}

@Component({
  selector: "showcase-a2ui-price-tag",
  host,
  template: ` <strong class="a2ui-price">{{ amount() }}</strong> `,
})
export class FixedPriceTagComponent {
  readonly amount = input.required<string>();
}

@Component({
  selector: "showcase-a2ui-button",
  imports: [CopilotGenerativeUIChildren],
  host,
  template: `
    <button type="button" class="a2ui-button" (click)="onClick()?.()">
      <ng-container *copilotGenerativeUIChildren="child()" />
    </button>
  `,
})
export class FixedButtonComponent {
  readonly child = input<GenerativeUIChildren>();
  readonly variant = input<"primary" | "secondary" | "ghost">();
  /** Set when the agent binds an action to the button. */
  readonly onClick = input<() => unknown>();
}
