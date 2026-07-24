import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { injectInterrupt, registerHumanInTheLoop } from "@copilotkit/angular";
import type { HumanInTheLoopConfig } from "@copilotkit/angular";
import { z } from "zod";

import { agentIdForRoute } from "../../feature-agent";
import { integrationId } from "../../runtime-context";
import { FeatureHeaderComponent } from "../feature-header.component";
import { ShowcaseChatHostComponent } from "../showcase-chat-host.component";
import { TimePickerCard } from "../tools/hitl-cards";
import { usesFrontendSchedulingTool } from "./interrupt-mode";
import { parseInterruptPayload } from "./interrupt-payload";
import type { InterruptSlot } from "./interrupt-payload";

type ScheduleMeetingArgs = {
  topic: string;
  attendee?: string;
};

@Component({
  selector: "showcase-interrupt-feature",
  imports: [FeatureHeaderComponent, ShowcaseChatHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="interrupt-layout" [class.interrupt-layout-headless]="isHeadless">
      @if (isHeadless) {
        <section
          class="interrupt-app-surface"
          data-testid="interrupt-headless-app-surface"
          aria-label="Scheduling application surface"
        >
          <header>
            <span>Headless interrupt</span>
            <h2>Scheduling</h2>
          </header>
          @if (controller.hasInterrupt()) {
            <article
              class="interrupt-picker"
              data-testid="interrupt-headless-popup"
              role="dialog"
              aria-modal="false"
              aria-labelledby="headless-interrupt-title"
            >
              <span>Pick a time</span>
              <h3 id="headless-interrupt-title">{{ payload().topic }}</h3>
              @if (payload().attendee; as attendee) {
                <p>with {{ attendee }}</p>
              }
              <div class="interrupt-slots">
                @for (slot of payload().slots; track slot.iso) {
                  <button
                    type="button"
                    [attr.data-testid]="'interrupt-headless-slot-' + slot.iso"
                    (click)="resolve(slot)"
                  >
                    {{ slot.label }}
                  </button>
                }
              </div>
              <button
                type="button"
                data-testid="interrupt-headless-cancel"
                (click)="cancel()"
              >
                Cancel
              </button>
            </article>
          } @else {
            <section class="interrupt-empty" data-testid="interrupt-headless-empty">
              <span aria-hidden="true">◷</span>
              <h3>Nothing scheduled yet</h3>
              <p>
                Ask the assistant to book something. Its picker will appear here.
              </p>
            </section>
          }
        </section>
      }

      <section class="chat-surface" aria-label="Interrupt chat demonstration">
        @if (!isHeadless && controller.hasInterrupt()) {
          <article class="interrupt-picker" data-testid="time-picker-card">
            <span>Pick a time</span>
            <h2>{{ payload().topic }}</h2>
            @if (pickedLabel(); as label) {
              <p data-testid="time-picker-picked">Booked {{ label }}</p>
            } @else {
              <div class="interrupt-slots">
                @for (slot of payload().slots; track slot.iso) {
                  <button
                    type="button"
                    data-testid="time-picker-slot"
                    (click)="resolve(slot)"
                  >
                    {{ slot.label }}
                  </button>
                }
              </div>
            }
          </article>
        }
        @if (controller.error()) {
          <p class="interrupt-error" role="alert">
            The decision could not be submitted. Please try again deliberately.
          </p>
        }
        <showcase-chat-host />
      </section>
    </main>
  `,
})
export class InterruptFeatureComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly feature =
    (this.route.snapshot.data["feature"] as string | undefined) ??
    "gen-ui-interrupt";
  protected readonly isHeadless = this.feature === "interrupt-headless";
  private readonly agentId = agentIdForRoute(this.feature, this.route);
  protected readonly controller = injectInterrupt({ agentId: this.agentId });
  protected readonly payload = computed(() =>
    parseInterruptPayload(this.controller.event()?.value),
  );
  protected readonly pickedLabel = signal<string | null>(null);
  private lastInterruptEvent: object | null = null;

  constructor() {
    effect(() => {
      const event = this.controller.event();
      if (event && event !== this.lastInterruptEvent) {
        this.lastInterruptEvent = event;
        this.pickedLabel.set(null);
      }
    });

    if (usesFrontendSchedulingTool(this.feature, integrationId())) {
      const config: HumanInTheLoopConfig<ScheduleMeetingArgs> = {
        agentId: this.agentId,
        name: "schedule_meeting",
        description:
          "Ask the user to pick a meeting time and return the selected slot.",
        parameters: z.object({
          topic: z.string(),
          attendee: z.string().optional(),
        }),
        component:
          TimePickerCard as unknown as HumanInTheLoopConfig<ScheduleMeetingArgs>["component"],
      };
      registerHumanInTheLoop(config);
    }
  }

  /** Resolve the active decision while retaining its visible confirmation. */
  protected resolve(slot: InterruptSlot): void {
    this.pickedLabel.set(slot.label);
    this.controller
      .resolve({
        chosen_time: slot.iso,
        chosen_label: slot.label,
      })
      .catch(() => undefined);
  }

  /** Cancel only the currently displayed interrupt. */
  protected cancel(): void {
    this.controller.cancel().catch(() => undefined);
  }
}
