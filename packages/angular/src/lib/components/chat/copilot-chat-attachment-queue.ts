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
import { injectChatLabels } from "../../chat-config";
import { hostStyles } from "../host-styles";

@Component({
  selector: "copilot-chat-attachment-queue",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [hostStyles],
  host: { "data-copilotkit": "" },
  template: `
    @if (attachments().length > 0) {
      <div data-testid="copilot-attachment-queue" [class]="computedClass()">
        @for (attachment of attachments(); track attachment.id) {
          <div [class]="itemClass(attachment)">
            @if (attachment.status === "uploading") {
              <div class="cpk-attachment-queue-uploading-overlay">
                <div class="cpk-attachment-queue-uploading-spinner"></div>
              </div>
            }

            @if (attachment.status === "uploading") {
              <div class="cpk-attachment-queue-placeholder"></div>
            } @else {
              @switch (attachment.type) {
                @case ("image") {
                  <img
                    [src]="sourceUrl(attachment)"
                    [alt]="attachment.filename || 'Image attachment'"
                    class="cpk-attachment-queue-image"
                  />
                }
                @case ("audio") {
                  <div class="cpk-attachment-queue-audio">
                    <audio
                      [src]="sourceUrl(attachment)"
                      controls
                      preload="metadata"
                      class="cpk-attachment-queue-audio-player"
                    ></audio>
                    @if (attachment.filename) {
                      <span class="cpk-attachment-queue-audio-filename">
                        {{ attachment.filename }}
                      </span>
                    }
                  </div>
                }
                @case ("video") {
                  <div class="cpk-attachment-queue-video">
                    @if (attachment.thumbnail) {
                      <img
                        [src]="attachment.thumbnail"
                        [alt]="attachment.filename || 'Video thumbnail'"
                        class="cpk-attachment-queue-video-thumbnail"
                      />
                    } @else {
                      <video
                        [src]="sourceUrl(attachment)"
                        preload="metadata"
                        muted
                        class="cpk-attachment-queue-video-thumbnail"
                      ></video>
                    }
                  </div>
                }
                @default {
                  <div class="cpk-attachment-queue-document">
                    <div class="cpk-attachment-queue-document-icon">
                      {{ documentIcon(attachment) }}
                    </div>
                    <div class="cpk-attachment-queue-document-info">
                      <span class="cpk-attachment-queue-document-name">
                        {{ attachment.filename || "Document" }}
                      </span>
                      @if (attachment.size != null) {
                        <span class="cpk-attachment-queue-document-size">
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
              class="cpk-attachment-queue-remove-button"
              [attr.aria-label]="labels.attachmentRemoveButtonLabel"
              (click)="removeAttachment.emit(attachment.id)"
            >
              ✕
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
  readonly labels = injectChatLabels();

  readonly computedClass = computed(() =>
    cn("copilotKitAttachmentQueue cpk-attachment-queue", this.inputClass()),
  );

  itemClass(attachment: Attachment): string {
    return cn(
      "cpk-attachment-queue-item",
      attachment.type === "image" || attachment.type === "video"
        ? "cpk-attachment-queue-item-media"
        : attachment.type === "audio"
          ? "cpk-attachment-queue-item-audio"
          : "cpk-attachment-queue-item-document",
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
