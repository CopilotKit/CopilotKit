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
import { CopilotIcon, Play } from "../icons/copilot-icon";
import { injectLightbox } from "./copilot-chat-lightbox";

@Component({
  selector: "copilot-chat-attachment-queue",
  imports: [CopilotIcon],
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
                  <button
                    #thumbnail
                    type="button"
                    class="cpk-attachment-lightbox-trigger"
                    (click)="
                      lightbox.open(
                        imagePreview,
                        attachment.filename || 'Image attachment',
                        thumbnail
                      )
                    "
                  >
                    <img
                      [src]="sourceUrl(attachment)"
                      [alt]="attachment.filename || 'Image attachment'"
                      class="cpk-attachment-queue-image"
                    />
                  </button>
                  <ng-template #imagePreview>
                    <img
                      [style.view-transition-name]="lightbox.transitionName"
                      [src]="sourceUrl(attachment)"
                      [alt]="attachment.filename || 'Image attachment'"
                      class="cpk-attachment-queue-lightbox-image"
                    />
                  </ng-template>
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
                  <div #videoThumbnail class="cpk-attachment-queue-video">
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
                  <button
                    type="button"
                    class="cpk-attachment-queue-video-play-button"
                    [attr.aria-label]="labels.attachmentPlayVideoButtonLabel"
                    (click)="
                      lightbox.open(
                        videoPreview,
                        attachment.filename || 'Video attachment',
                        videoThumbnail
                      )
                    "
                  >
                    <span class="cpk-attachment-queue-video-play-badge">
                      <copilot-icon
                        [img]="PlayIcon"
                        iconClass="cpk-attachment-queue-video-play-icon"
                      ></copilot-icon>
                    </span>
                  </button>
                  <ng-template #videoPreview>
                    <video
                      [style.view-transition-name]="lightbox.transitionName"
                      [src]="sourceUrl(attachment)"
                      controls
                      autoplay
                      class="cpk-attachment-queue-lightbox-video"
                    ></video>
                  </ng-template>
                }
                @default {
                  <div class="cpk-attachment-queue-document">
                    <div class="cpk-attachment-queue-document-icon">
                      {{ documentIcon(attachment) }}
                    </div>
                    <div class="cpk-attachment-queue-document-info">
                      <span class="cpk-attachment-queue-document-name">
                        {{ attachment.filename || labels.attachmentDocumentLabel }}
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
  /** Opens an image or video full screen. */
  readonly lightbox = injectLightbox();
  readonly PlayIcon = Play;

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
