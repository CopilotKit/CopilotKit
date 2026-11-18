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
import { injectChatLabels } from "../../chat-config";
import { injectLightbox } from "./copilot-chat-lightbox";

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
            <span>{{ labels.attachmentImageLoadErrorText }}</span>
          </div>
        } @else {
          <button
            #thumbnail
            type="button"
            class="cpk-attachment-lightbox-trigger"
            (click)="
              lightbox.open(imagePreview, labels.attachmentImageAltText, thumbnail)
            "
          >
            <img
              [src]="sourceUrl()"
              [alt]="labels.attachmentImageAltText"
              [class]="imageClass()"
              (error)="imageFailed.set(true)"
            />
          </button>
          <ng-template #imagePreview>
            <img
              [style.view-transition-name]="lightbox.transitionName"
              [src]="sourceUrl()"
              [alt]="labels.attachmentImageAltText"
              class="cpk-attachment-renderer-lightbox-image"
            />
          </ng-template>
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
        <!-- download works for same-origin, data: and blob: URLs; target="_blank"
             opens other files in a new tab instead of leaving the chat. -->
        <a
          [href]="sourceUrl()"
          [attr.download]="filename() ?? ''"
          target="_blank"
          rel="noopener noreferrer"
          [attr.aria-label]="
            filename() || source().mimeType || labels.attachmentDocumentAltText
          "
          [class]="documentClass()"
        >
          <span class="cpk-attachment-renderer-document-icon">
            {{ documentIcon() }}
          </span>
          <span class="cpk-attachment-renderer-document-name">
            {{
              filename() || source().mimeType || labels.attachmentUnknownTypeText
            }}
          </span>
        </a>
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
  readonly labels = injectChatLabels();
  /** Opens the image full screen. */
  readonly lightbox = injectLightbox();
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
