import { ChangeDetectionStrategy, Component } from "@angular/core";

import { FeatureHeaderComponent } from "../feature-header.component";
import { HeadlessChatController } from "./headless-chat";
import { messageText } from "./headless-message-utils";

@Component({
  selector: "showcase-headless-simple-feature",
  imports: [FeatureHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="headless-page" aria-label="Simple headless chat">
      <section class="headless-panel">
        <h2>Headless Chat (Simple)</h2>
        <div class="headless-messages" aria-live="polite">
          @if (messages().length === 0) {
            <p class="headless-empty">No messages yet. Say hi!</p>
          }
          @for (message of messages(); track message.id) {
            @if (message.role === "user") {
              <div
                class="headless-user-message"
                data-testid="headless-message-user"
                data-message-role="user"
              >
                {{ messageText(message) }}
              </div>
            } @else if (message.role === "assistant") {
              <div
                class="headless-assistant-message"
                data-testid="headless-message-assistant"
                data-message-role="assistant"
              >
                {{ messageText(message) }}
              </div>
            }
          }
          @if (isRunning()) {
            <p class="headless-status">Agent is thinking…</p>
          }
        </div>
        <div class="headless-suggestions" data-testid="headless-suggestions">
          @for (suggestion of suggestions; track suggestion) {
            <button
              type="button"
              [disabled]="isRunning()"
              (click)="send(suggestion)"
            >
              {{ suggestion }}
            </button>
          }
        </div>
        @if (error()) {
          <p
            class="headless-error"
            data-testid="headless-simple-error"
            role="alert"
          >
            {{ error() }}
          </p>
        }
        <div class="headless-composer" data-testid="headless-composer">
          <textarea
            rows="2"
            aria-label="Message"
            placeholder="Type a message"
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
export class HeadlessSimpleFeatureComponent extends HeadlessChatController {
  protected readonly messageText = messageText;
  protected readonly suggestions = [
    "Say hello in one short sentence.",
    "Tell me a one-line joke.",
    "Give me a fun fact.",
  ] as const;
}
