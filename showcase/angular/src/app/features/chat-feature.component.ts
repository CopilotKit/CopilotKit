import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { CopilotChat } from "@copilotkit/angular";

@Component({
  selector: "showcase-chat-feature",
  imports: [CopilotChat],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <header class="feature-header">
      <div>
        <h1>{{ featureName() }}</h1>
        <p>{{ cellId() }}</p>
      </div>
      <span class="framework-badge">Angular</span>
    </header>
    <main class="chat-surface" aria-label="CopilotKit Angular demo">
      <copilot-chat />
    </main>
  `,
})
export class ChatFeatureComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly integration =
    this.route.snapshot.paramMap.get("integration") ?? "unknown";
  protected readonly feature =
    (this.route.snapshot.data["feature"] as string | undefined) ?? "unknown";
  protected readonly featureName = computed(() =>
    this.feature
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  );
  protected readonly cellId = computed(
    () => `angular/${this.integration}/${this.feature}`,
  );
}
