import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
  ViewEncapsulation,
} from "@angular/core";
import type {
  AttachmentModality,
  InputContentSource,
} from "@copilotkit/shared";
import { getDocumentIcon, getSourceUrl } from "@copilotkit/shared";
import { cn } from "../../utils";

@Component({
  selector: "copilot-chat-attachment-renderer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { "data-copilotkit": "" },
  template: `
    @switch (type()) {
      @case ("image") {
        @if (imageFailed()) {
          <div [class]="failedImageClass()">
            <span>Failed to load image</span>
          </div>
        } @else {
          <img
            [src]="sourceUrl()"
            alt="Image attachment"
            [class]="imageClass()"
            (error)="imageFailed.set(true)"
          />
        }
      }
      @case ("audio") {
        <div [class]="audioClass()">
          <audio
            [src]="sourceUrl()"
            controls
            preload="metadata"
            class="cpk-attachment-renderer-audio-player"
          ></audio>
          @if (filename()) {
            <span class="cpk-attachment-renderer-audio-filename">
              {{ filename() }}
            </span>
          }
        </div>
      }
      @case ("video") {
        <video
          [src]="sourceUrl()"
          controls
          preload="metadata"
          [class]="videoClass()"
        ></video>
      }
      @default {
        <div [class]="documentClass()">
          <span class="cpk-attachment-renderer-document-icon">
            {{ documentIcon() }}
          </span>
          <span class="cpk-attachment-renderer-document-name">
            {{ filename() || source().mimeType || "Unknown type" }}
          </span>
        </div>
      }
    }
  `,
})
export class CopilotChatAttachmentRenderer {
  readonly type = input.required<AttachmentModality>();
  readonly source = input.required<InputContentSource>();
  readonly filename = input<string | undefined>();
  readonly inputClass = input<string | undefined>();

  readonly imageFailed = signal(false);
  readonly sourceUrl = computed(() => getSourceUrl(this.source()));
  readonly documentIcon = computed(() =>
    getDocumentIcon(this.source().mimeType ?? ""),
  );

  readonly imageClass = computed(() =>
    cn(
      "cpk-attachment-renderer cpk-attachment-renderer-image",
      this.inputClass(),
    ),
  );
  readonly failedImageClass = computed(() =>
    cn(
      "cpk-attachment-renderer cpk-attachment-renderer-image-error",
      this.inputClass(),
    ),
  );
  readonly audioClass = computed(() =>
    cn(
      "cpk-attachment-renderer cpk-attachment-renderer-audio",
      this.inputClass(),
    ),
  );
  readonly videoClass = computed(() =>
    cn(
      "cpk-attachment-renderer cpk-attachment-renderer-video",
      this.inputClass(),
    ),
  );
  readonly documentClass = computed(() =>
    cn(
      "cpk-attachment-renderer cpk-attachment-renderer-document",
      this.inputClass(),
    ),
  );
}
