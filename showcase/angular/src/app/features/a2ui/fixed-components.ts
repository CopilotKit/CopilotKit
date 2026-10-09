import { Component, input } from "@angular/core";
import type { A2UIProps } from "@copilotkit/angular/a2ui";
import {
  CopilotA2UIChild,
  injectA2UIComponentContext,
} from "@copilotkit/angular/a2ui";

import type { fixedDefinitions } from "./a2ui-definitions";
import { a2uiHost as host } from "./a2ui-host";

type Props<K extends keyof typeof fixedDefinitions> = A2UIProps<
  typeof fixedDefinitions,
  K
>;

@Component({
  selector: "showcase-a2ui-flight-card",
  imports: [CopilotA2UIChild],
  host,
  template: `
    <article data-testid="a2ui-fixed-card" class="a2ui-flight-card">
      <copilot-a2ui-child [child]="props().child" />
    </article>
  `,
})
export class FixedCardComponent {
  readonly props = input.required<Props<"Card">>();
}

@Component({
  selector: "showcase-a2ui-title",
  host,
  template: `
    <h3>{{ props().text }}</h3>
  `,
})
export class FixedTitleComponent {
  readonly props = input.required<Props<"Title">>();
}

@Component({
  selector: "showcase-a2ui-airport",
  host,
  template: `
    <strong class="a2ui-airport">{{ props().code }}</strong>
  `,
})
export class FixedAirportComponent {
  readonly props = input.required<Props<"Airport">>();
}

@Component({
  selector: "showcase-a2ui-arrow",
  host,
  template: `
    <span class="a2ui-arrow" aria-hidden="true">→</span>
  `,
})
export class FixedArrowComponent {
  readonly props = input.required<Props<"Arrow">>();
}

@Component({
  selector: "showcase-a2ui-airline-badge",
  host,
  template: `
    <span class="a2ui-airline">{{ props().name }}</span>
  `,
})
export class FixedAirlineBadgeComponent {
  readonly props = input.required<Props<"AirlineBadge">>();
}

@Component({
  selector: "showcase-a2ui-price-tag",
  host,
  template: `
    <strong class="a2ui-price">{{ props().amount }}</strong>
  `,
})
export class FixedPriceTagComponent {
  readonly props = input.required<Props<"PriceTag">>();
}

@Component({
  selector: "showcase-a2ui-button",
  imports: [CopilotA2UIChild],
  host,
  template: `
    <button
      type="button"
      class="a2ui-button"
      (click)="context.dispatch(props().action)"
    >
      <copilot-a2ui-child [child]="props().child" />
    </button>
  `,
})
export class FixedButtonComponent {
  readonly props = input.required<Props<"Button">>();
  protected readonly context = injectA2UIComponentContext();
}
