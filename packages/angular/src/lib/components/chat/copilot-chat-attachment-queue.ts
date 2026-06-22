import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  ViewEncapsulation,
} from "@angular/core";
import type { Attachment } from "@copilotkit/shared";
import {
  formatFileSize,
  getDocumentIcon,
  getSourceUrl,
} from "@copilotkit/shared";
import { cn } from "../../utils";

@Component({
  selector: "copilot-chat-attachment-queue",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { "data-copilotkit": "" },
  template: `
    @if (attachments().length > 0) {
      <div data-testid="copilot-attachment-queue" [class]="computedClass()">
        @for (attachment of attachments(); track attachment.id) {
          <div [class]="itemClass(attachment)">
            @if (attachment.status === "uploading") {
              <div class="copilotKitAttachmentQueueOverlay">
                <div class="copilotKitAttachmentQueueSpinner"></div>
              </div>
            }

            @if (attachment.status === "uploading") {
              <div class="copilotKitAttachmentQueuePreviewPlaceholder"></div>
            } @else {
              @switch (attachment.type) {
                @case ("image") {
                  <img
                    [src]="sourceUrl(attachment)"
                    [alt]="attachment.filename || 'Image attachment'"
                    class="copilotKitAttachmentQueuePreviewImage"
                  />
                }
                @case ("audio") {
                  <div class="copilotKitAttachmentQueuePreviewAudio">
                    <audio
                      [src]="sourceUrl(attachment)"
                      controls
                      preload="metadata"
                    ></audio>
                    @if (attachment.filename) {
                      <span class="copilotKitAttachmentQueueFilename">
                        {{ attachment.filename }}
                      </span>
                    }
                  </div>
                }
                @case ("video") {
                  <div class="copilotKitAttachmentQueuePreviewVideo">
                    @if (attachment.thumbnail) {
                      <img
                        [src]="attachment.thumbnail"
                        [alt]="attachment.filename || 'Video thumbnail'"
                        class="copilotKitAttachmentQueuePreviewImage"
                      />
                    } @else {
                      <video
                        [src]="sourceUrl(attachment)"
                        preload="metadata"
                        muted
                        class="copilotKitAttachmentQueuePreviewImage"
                      ></video>
                    }
                  </div>
                }
                @default {
                  <div class="copilotKitAttachmentQueuePreviewDocument">
                    <div class="copilotKitAttachmentQueueDocIcon">
                      {{ documentIcon(attachment) }}
                    </div>
                    <div class="copilotKitAttachmentQueueDocInfo">
                      <span class="copilotKitAttachmentQueueFilename">
                        {{ attachment.filename || "Document" }}
                      </span>
                      @if (attachment.size != null) {
                        <span class="copilotKitAttachmentQueueFileSize">
                          {{ fileSize(attachment) }}
                        </span>
                      }
                    </div>
                  </div>
                }
              }
            }

            <button
              type="button"
              class="copilotKitAttachmentQueueRemoveButton"
              aria-label="Remove attachment"
              (click)="removeAttachment.emit(attachment.id)"
            >
              &times;
            </button>
          </div>
        }
      </div>
    }
  `,
})
export class CopilotChatAttachmentQueue {
  readonly attachments = input<Attachment[]>([]);
  readonly inputClass = input<string | undefined>();
  readonly removeAttachment = output<string>();

  readonly computedClass = computed(() =>
    cn(
      "copilotKitAttachmentQueue cpk:flex cpk:flex-wrap cpk:gap-2 cpk:p-2",
      this.inputClass(),
    ),
  );

  itemClass(attachment: Attachment): string {
    return cn(
      "copilotKitAttachmentQueueItem",
      `copilotKitAttachmentQueueItem--${attachment.type}`,
    );
  }

  sourceUrl(attachment: Attachment): string {
    return getSourceUrl(attachment.source);
  }

  documentIcon(attachment: Attachment): string {
    return getDocumentIcon(attachment.source.mimeType ?? "");
  }

  fileSize(attachment: Attachment): string {
    return formatFileSize(attachment.size ?? 0);
  }
}
