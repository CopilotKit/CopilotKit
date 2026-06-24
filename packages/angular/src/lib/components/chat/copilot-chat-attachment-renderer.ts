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
            <div class="copilotKitImageRenderingErrorMessage">
              Failed to load image
            </div>
          </div>
        } @else {
          <div [class]="imageWrapperClass()">
            <img
              [src]="sourceUrl()"
              alt="Image attachment"
              class="copilotKitImageRenderingImage"
              (error)="imageFailed.set(true)"
            />
          </div>
        }
      }
      @case ("audio") {
        <div [class]="audioClass()">
          <audio [src]="sourceUrl()" controls preload="metadata"></audio>
          @if (filename()) {
            <span class="copilotKitAttachmentFilename">
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
          <div class="copilotKitAttachmentDocIcon">{{ documentIcon() }}</div>
          <div class="copilotKitAttachmentDocInfo">
            <span class="copilotKitAttachmentDocName">
              {{ filename() || source().mimeType || "Unknown type" }}
            </span>
          </div>
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

  readonly imageWrapperClass = computed(() =>
    cn("copilotKitImageRendering", this.inputClass()),
  );
  readonly failedImageClass = computed(() =>
    cn(
      "copilotKitImageRendering copilotKitImageRenderingError",
      this.inputClass(),
    ),
  );
  readonly audioClass = computed(() =>
    cn("copilotKitAttachment copilotKitAttachmentAudio", this.inputClass()),
  );
  readonly videoClass = computed(() =>
    cn("copilotKitAttachment copilotKitAttachmentVideo", this.inputClass()),
  );
  readonly documentClass = computed(() =>
    cn("copilotKitAttachment copilotKitAttachmentDocument", this.inputClass()),
  );
}
