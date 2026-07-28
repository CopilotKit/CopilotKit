import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { integrationId } from "../runtime-context";

@Component({
  selector: "showcase-feature-header",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="feature-header">
      <div>
        <h1>{{ title }}</h1>
        <p>{{ cellId }}</p>
      </div>
      <span class="framework-badge">Angular</span>
    </header>
  `,
})
export class FeatureHeaderComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly integration = integrationId();
  protected readonly feature =
    (this.route.snapshot.data["feature"] as string | undefined) ?? "unknown";
  protected readonly title = this.feature
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  protected readonly cellId = `angular/${this.integration}/${this.feature}`;
}
