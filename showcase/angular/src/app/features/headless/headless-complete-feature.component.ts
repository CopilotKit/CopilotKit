import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import { registerFrontendTool } from "@copilotkit/angular";
import type { AngularToolCall } from "@copilotkit/angular";
import { z } from "zod";

import { FeatureHeaderComponent } from "../feature-header.component";
import { HeadlessChatController } from "./headless-chat";
import type { ShowcaseMessage } from "./headless-chat.types";
import { messageText, toolArguments } from "./headless-message-utils";

@Component({
  selector: "showcase-headless-weather-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "headless-tool-card", "data-testid": "headless-weather-card" },
  template: `
    <span>Weather</span><strong>{{ location() }}</strong>
    <p>22°C · Partly cloudy</p>
  `,
})
export class HeadlessWeatherCard {
  readonly toolCall =
    input.required<AngularToolCall<{ location?: string; city?: string }>>();
  protected readonly location = computed(
    () => this.toolCall().args.location ?? this.toolCall().args.city ?? "Tokyo",
  );
}

@Component({
  selector: "showcase-headless-stock-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "headless-tool-card", "data-testid": "headless-stock-card" },
  template: `
    <span>Stock price</span><strong>{{ toolCall().args.ticker ?? "AAPL" }}</strong>
    <p>$189.42 · +1.27%</p>
  `,
})
export class HeadlessStockCard {
  readonly toolCall = input.required<AngularToolCall<{ ticker?: string }>>();
}

@Component({
  selector: "showcase-headless-highlight-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "headless-tool-card highlight",
    "data-testid": "headless-highlight-card",
  },
  template: `
    <span>Highlighted note</span
    ><strong>{{ toolCall().args.text ?? "Note" }}</strong>
  `,
})
export class HeadlessHighlightCard {
  readonly toolCall =
    input.required<AngularToolCall<{ text?: string; color?: string }>>();
}

@Component({
  selector: "showcase-headless-revenue-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "headless-tool-card",
    "data-testid": "headless-revenue-chart",
  },
  template: `
    <span>Revenue</span><strong>Six-month revenue</strong>
    <div class="mini-bars" aria-label="Revenue increased over six months">
      @for (height of bars; track $index) {
        <i [style.height.%]="height"></i>
      }
    </div>
  `,
})
export class HeadlessRevenueCard {
  readonly toolCall = input.required<AngularToolCall>();
  protected readonly bars = [32, 45, 51, 63, 74, 92];
}

@Component({
  selector: "showcase-headless-complete-feature",
  imports: [
    FeatureHeaderComponent,
    HeadlessWeatherCard,
    HeadlessStockCard,
    HeadlessHighlightCard,
    HeadlessRevenueCard,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="headless-page" aria-label="Complete headless chat">
      <section
        class="headless-panel"
        data-testid="copilot-chat"
        [attr.data-copilot-running]="isRunning()"
      >
        <h2>Headless Chat (Complete)</h2>
        <div class="headless-messages" aria-live="polite">
          @for (message of messages(); track message.id) {
            @if (message.role === "user") {
              <div class="headless-user-message" data-message-role="user">
                {{ messageText(message) }}
              </div>
            } @else if (message.role === "assistant") {
              <div
                class="headless-assistant-message"
                data-testid="headless-message-assistant"
                data-message-role="assistant"
              >
                @if (messageText(message); as content) {
                  <p>{{ content }}</p>
                }
                @for (call of message.toolCalls ?? []; track call.id) {
                  @switch (call.function.name) {
                    @case ("get_weather") {
                      <showcase-headless-weather-card [toolCall]="toolCall(call)" />
                    }
                    @case ("get_stock_price") {
                      <showcase-headless-stock-card [toolCall]="toolCall(call)" />
                    }
                    @case ("highlight_note") {
                      <showcase-headless-highlight-card
                        [toolCall]="toolCall(call)"
                      />
                    }
                    @case ("get_revenue_chart") {
                      <showcase-headless-revenue-card [toolCall]="toolCall(call)" />
                    }
                  }
                }
              </div>
            }
          }
        </div>
        <div class="headless-suggestions">
          @for (suggestion of suggestions; track suggestion.label) {
            <button
              type="button"
              [disabled]="isRunning()"
              (click)="send(suggestion.prompt)"
            >
              {{ suggestion.label }}
            </button>
          }
        </div>
        @if (error()) {
          <p class="headless-error" role="alert">{{ error() }}</p>
        }
        <div class="headless-composer">
          <textarea
            rows="2"
            aria-label="Message"
            [value]="inputValue()"
            (input)="updateInput($event)"
            (keydown)="handleComposerKeydown($event)"
          ></textarea>
          <button
            type="button"
            [disabled]="isRunning() || !inputValue().trim()"
            (click)="send()"
          >
            Send
          </button>
        </div>
      </section>
    </main>
  `,
})
export class HeadlessCompleteFeatureComponent extends HeadlessChatController {
  protected readonly messageText = messageText;
  protected readonly suggestions = [
    { label: "Weather", prompt: "What's the weather in Tokyo?" },
    { label: "Stock price", prompt: "What's the price of AAPL right now?" },
    {
      label: "Highlight a note",
      prompt: "Highlight this note for me: 'ship the demo on Friday'.",
    },
    {
      label: "Revenue chart",
      prompt: "Show me a chart of revenue over the last six months.",
    },
  ] as const;

  constructor() {
    super("headless-complete");
    registerFrontendTool({
      name: "highlight_note",
      description: "Highlight a short note or phrase in the chat.",
      parameters: z.object({
        text: z.string(),
        color: z.string().optional(),
      }),
      followUp: false,
      handler: async ({ text, color }) => ({ text, color: color ?? "yellow" }),
    });
  }

  protected toolCall(
    call: NonNullable<ShowcaseMessage["toolCalls"]>[number],
  ): AngularToolCall {
    return {
      name: call.function.name,
      args: toolArguments(call.function.arguments),
      status: "executing",
      result: undefined,
    };
  }
}
