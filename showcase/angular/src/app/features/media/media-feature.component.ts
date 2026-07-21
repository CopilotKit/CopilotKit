import type { AttachmentsConfig } from "@copilotkit/angular";
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { CopilotKit, injectAgentStore } from "@copilotkit/angular";

import { FeatureHeaderComponent } from "../feature-header.component";
import { ShowcaseChatHostComponent } from "../showcase-chat-host.component";
import {
  createMultimodalMessage,
  dedupeUserMessageMedia,
  populateChatComposer,
  rewriteMessagesForLegacyConverter,
  validateSampleBytes,
} from "./media-model";
import type { MediaAgentMessage, SampleSpec } from "./media-model";

const VOICE_SAMPLE_TEXT = "What is the weather in Tokyo?";

const SAMPLES: readonly SampleSpec[] = [
  {
    buttonLabel: "Try with sample image",
    filename: "sample.png",
    mimeType: "image/png",
    testId: "multimodal-sample-image-button",
    fetchUrl: "/demo-files/sample.png",
    autoPrompt: "can you tell me what is in this demo image I just attached",
  },
  {
    buttonLabel: "Try with sample PDF",
    filename: "sample.pdf",
    mimeType: "application/pdf",
    testId: "multimodal-sample-pdf-button",
    fetchUrl: "/demo-files/sample.pdf",
    autoPrompt: "can you tell me what is in this demo pdf I just attached",
  },
];

const MULTIMODAL_ATTACHMENTS: AttachmentsConfig = {
  enabled: true,
  accept: "image/*,application/pdf",
  maxSize: 10 * 1024 * 1024,
};

@Component({
  selector: "showcase-media-feature",
  imports: [FeatureHeaderComponent, ShowcaseChatHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="media-page">
      <section class="sample-panel" aria-label="Bundled media samples">
        @if (feature === "voice") {
          <div class="sample-copy">
            <strong>Voice input</strong>
            <span>Use the microphone, or insert a deterministic sample.</span>
          </div>
          <button
            type="button"
            data-testid="voice-sample-audio-button"
            [title]="'Inserts: &quot;' + voiceSampleText + '&quot;'"
            (click)="insertVoiceSample()"
          >
            <span aria-hidden="true">🎙</span>
            <span>Try a sample audio</span>
          </button>
        } @else {
          <div class="sample-copy">
            <strong>Bundled samples</strong>
            <span>Send a real image or PDF through the agent runtime.</span>
          </div>
          <div class="sample-actions">
            @for (sample of samples; track sample.testId) {
              <button
                type="button"
                [attr.data-testid]="sample.testId"
                [disabled]="loading() !== null"
                (click)="sendSample(sample)"
              >
                {{ loading() === sample.testId ? "Sending…" : sample.buttonLabel }}
              </button>
            }
          </div>
        }
        @if (error()) {
          <p class="sample-error" role="alert">{{ error() }}</p>
        }
      </section>
      <section class="chat-surface" aria-label="CopilotKit assistant">
        <showcase-chat-host
          [agentId]="agentId"
          [attachments]="
            feature === 'multimodal' ? multimodalAttachments : undefined
          "
        />
      </section>
    </main>
  `,
  styles: `
    .media-page {
      display: grid;
      min-height: 0;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 0.75rem;
      padding: 0.75rem;
      background: #eef3f7;
    }
    .sample-panel {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem 1rem;
      padding: 0.75rem 1rem;
      border: 1px solid #d8e0ea;
      border-radius: 0.9rem;
      background: #fff;
    }
    .sample-copy {
      display: grid;
      flex: 1 1 16rem;
      gap: 0.15rem;
      color: #14213d;
    }
    .sample-copy span {
      color: #52637a;
      font-size: 0.82rem;
    }
    .sample-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.55rem 0.8rem;
      border: 1px solid #c7d2e0;
      border-radius: 0.65rem;
      color: #20324d;
      background: #fff;
      font: inherit;
      font-size: 0.84rem;
      font-weight: 650;
      cursor: pointer;
    }
    button:hover:not(:disabled) {
      border-color: #4263eb;
      background: #f5f7ff;
    }
    button:focus-visible {
      outline: 3px solid #91a7ff;
      outline-offset: 2px;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.62;
    }
    .sample-error {
      flex-basis: 100%;
      margin: 0;
      color: #991b1b;
      font-size: 0.84rem;
    }
    .chat-surface {
      min-height: 0;
      overflow: hidden;
      border: 1px solid #d8e0ea;
      border-radius: 1rem;
      background: #fff;
    }
  `,
})
export class MediaFeatureComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly copilotKit = inject(CopilotKit);
  protected readonly feature =
    (this.route.snapshot.data["feature"] as string | undefined) ?? "voice";
  protected readonly agentId =
    this.feature === "multimodal" ? "multimodal-demo" : "voice-demo";
  private readonly agentStore = injectAgentStore(this.agentId);
  protected readonly voiceSampleText = VOICE_SAMPLE_TEXT;
  protected readonly samples = SAMPLES;
  protected readonly multimodalAttachments = MULTIMODAL_ATTACHMENTS;
  protected readonly loading = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    if (this.feature === "multimodal") {
      effect((onCleanup) => {
        const handle = installLegacyConverterShim(this.agentStore().agent);
        onCleanup(() => handle.unsubscribe());
      });
    }
  }

  /** Insert the deterministic voice sample into the actual chat composer. */
  protected insertVoiceSample(): void {
    if (!populateChatComposer(this.host.nativeElement, VOICE_SAMPLE_TEXT)) {
      this.error.set("The chat composer is not ready yet. Try again.");
      return;
    }
    this.error.set(null);
  }

  /** Fetch, validate, attach, and dispatch one canonical media sample. */
  protected async sendSample(spec: SampleSpec): Promise<void> {
    if (this.loading() !== null) return;
    this.loading.set(spec.testId);
    this.error.set(null);
    try {
      const response = await fetch(spec.fetchUrl);
      if (!response.ok) {
        throw new Error(
          `Could not fetch sample "${spec.filename}" (HTTP ${response.status}).`,
        );
      }
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      validateSampleBytes(bytes, spec.mimeType, spec.filename);
      const base64 = await bufferToBase64(buffer, spec.mimeType);
      const agent = this.agentStore().agent;
      const message = createMultimodalMessage(
        spec,
        base64,
        buffer.byteLength,
        createMessageId(),
      );
      agent.addMessage(message as Parameters<typeof agent.addMessage>[0]);
      await this.copilotKit.core.runAgent({ agent });
    } catch (error: unknown) {
      console.error("[showcase-angular:multimodal] Sample send failed", error);
      this.error.set(
        error instanceof Error ? error.message : "The sample send failed.",
      );
    } finally {
      this.loading.set(null);
    }
  }
}

interface SubscribableAgent {
  subscribe: (subscriber: unknown) => { unsubscribe: () => void };
}

/** Install the converter compatibility subscribers on one active agent. */
function installLegacyConverterShim(agent: object): {
  unsubscribe: () => void;
} {
  const rewrite = ({
    messages,
  }: {
    messages: ReadonlyArray<Readonly<MediaAgentMessage>>;
  }) => {
    const rewritten = rewriteMessagesForLegacyConverter(messages);
    return rewritten ? { messages: rewritten } : undefined;
  };
  const dedupe = ({
    messages,
  }: {
    messages: ReadonlyArray<Readonly<MediaAgentMessage>>;
  }) => {
    const deduped = dedupeUserMessageMedia(messages);
    return deduped ? { messages: deduped } : undefined;
  };
  return (agent as SubscribableAgent).subscribe({
    onRunInitialized: rewrite,
    onMessagesSnapshotEvent: dedupe,
    onRunFinalized: dedupe,
  });
}

/** Convert browser bytes to the base64 payload used by AG-UI data sources. */
function bufferToBase64(
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "error",
      () =>
        reject(
          reader.error ?? new Error("The selected media could not be read."),
        ),
      { once: true },
    );
    reader.addEventListener(
      "load",
      () => {
        if (typeof reader.result !== "string") {
          reject(new Error("The selected media returned an invalid result."));
          return;
        }
        const comma = reader.result.indexOf(",");
        resolve(comma >= 0 ? reader.result.slice(comma + 1) : reader.result);
      },
      { once: true },
    );
    reader.readAsDataURL(new Blob([buffer], { type: mimeType }));
  });
}

/** Create a collision-resistant client message identifier. */
function createMessageId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `angular-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
