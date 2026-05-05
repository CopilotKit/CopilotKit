import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  ContentChild,
  TemplateRef,
  Type,
  computed,
  input,
  output,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  type Attachment,
  formatFileSize,
  getDocumentIcon,
  getSourceUrl,
} from "@copilotkit/shared";
import { CopilotSlot } from "../../slots/copilot-slot";
import { cn } from "../../utils";
import type {
  AttachmentQueueContainerContext,
  AttachmentQueueItemContext,
  AttachmentQueueRemoveEvent,
} from "./copilot-chat-attachment-queue.types";

const containerBaseClasses =
  "flex flex-wrap items-center gap-2 pointer-events-auto";

const itemBaseClasses =
  "relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-background";

const overlayClasses =
  "absolute inset-0 z-10 flex items-center justify-center bg-background/60";

const spinnerClasses =
  "h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground";

const removeButtonClasses =
  "absolute -right-1.5 -top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-background text-[11px] leading-none text-foreground hover:bg-accent/60";

const previewImageClasses = "h-full w-full object-cover";
const previewPlaceholderClasses = "h-full w-full bg-muted";
const previewDocClasses = "flex flex-col items-center gap-0.5 p-1 text-center";
const previewDocIconClasses =
  "text-[9px] font-semibold uppercase tracking-wide text-muted-foreground";
const previewDocFilenameClasses =
  "max-w-full truncate text-[10px] text-foreground";
const previewDocSizeClasses = "text-[9px] text-muted-foreground";

/**
 * Default queue container.
 */
@Component({
  standalone: true,
  selector: "copilot-chat-attachment-queue-container",
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      data-copilotkit
      data-testid="copilot-attachment-queue"
      [class]="containerClass()"
    >
      <ng-content></ng-content>
    </div>
  `,
})
export class CopilotChatAttachmentQueueContainer {
  readonly inputClass = input<string | undefined>(undefined);

  readonly containerClass = computed(() =>
    cn(containerBaseClasses, this.inputClass()),
  );
}

/**
 * Default queue item: thumbnail / preview + remove (`x`) control.
 */
@Component({
  standalone: true,
  selector: "copilot-chat-attachment-queue-item",
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      data-copilotkit
      data-testid="copilot-attachment-queue-item"
      [attr.data-attachment-type]="attachment().type"
      [class]="itemClass"
    >
      @if (isUploading()) {
        <div [class]="overlayClass">
          <div [class]="spinnerClass" aria-hidden="true"></div>
        </div>
      }

      @switch (attachment().type) {
        @case ("image") {
          @if (!isUploading()) {
            <img
              [src]="src()"
              [alt]="attachment().filename || 'Image attachment'"
              [class]="previewImageClass"
            />
          } @else {
            <div [class]="previewPlaceholderClass"></div>
          }
        }
        @case ("audio") {
          @if (!isUploading()) {
            <div [class]="previewDocClass">
              <span [class]="previewDocIconClass">AUD</span>
              @if (attachment().filename) {
                <span [class]="previewDocFilenameClass">{{
                  attachment().filename
                }}</span>
              }
            </div>
          } @else {
            <div [class]="previewPlaceholderClass"></div>
          }
        }
        @case ("video") {
          @if (!isUploading()) {
            @if (attachment().thumbnail) {
              <img
                [src]="attachment().thumbnail"
                [alt]="attachment().filename || 'Video thumbnail'"
                [class]="previewImageClass"
              />
            } @else {
              <video
                [src]="src()"
                preload="metadata"
                muted
                [class]="previewImageClass"
              ></video>
            }
          } @else {
            <div [class]="previewPlaceholderClass"></div>
          }
        }
        @case ("document") {
          @if (!isUploading()) {
            <div [class]="previewDocClass">
              <span [class]="previewDocIconClass">{{ documentIcon() }}</span>
              <span [class]="previewDocFilenameClass">{{
                attachment().filename || "Document"
              }}</span>
              @if (attachment().size != null) {
                <span [class]="previewDocSizeClass">{{
                  formattedSize()
                }}</span>
              }
            </div>
          } @else {
            <div [class]="previewPlaceholderClass"></div>
          }
        }
      }

      <button
        type="button"
        data-testid="copilot-attachment-remove"
        [class]="removeButtonClass"
        aria-label="Remove attachment"
        (click)="handleRemove($event)"
      >
        &#x2715;
      </button>
    </div>
  `,
})
export class CopilotChatAttachmentQueueItem {
  readonly attachment = input.required<Attachment>();
  readonly src = input<string>("");
  readonly isUploading = input<boolean>(false);
  readonly clickHandler = input<((event?: Event) => void) | undefined>(
    undefined,
  );

  readonly removed = output<Event>();

  protected readonly itemClass = itemBaseClasses;
  protected readonly overlayClass = overlayClasses;
  protected readonly spinnerClass = spinnerClasses;
  protected readonly removeButtonClass = removeButtonClasses;
  protected readonly previewImageClass = previewImageClasses;
  protected readonly previewPlaceholderClass = previewPlaceholderClasses;
  protected readonly previewDocClass = previewDocClasses;
  protected readonly previewDocIconClass = previewDocIconClasses;
  protected readonly previewDocFilenameClass = previewDocFilenameClasses;
  protected readonly previewDocSizeClass = previewDocSizeClasses;

  readonly documentIcon = computed(() =>
    getDocumentIcon(this.attachment().source.mimeType ?? ""),
  );

  readonly formattedSize = computed(() => {
    const size = this.attachment().size;
    return size != null ? formatFileSize(size) : "";
  });

  handleRemove(event: Event): void {
    const fn = this.clickHandler();
    if (fn) fn(event);
    this.removed.emit(event);
  }
}

interface AttachmentQueueEntry {
  key: string;
  attachment: Attachment;
  context: AttachmentQueueItemContext;
}

/**
 * Queue/list view of pending chat attachments. Supports per-attachment status
 * (`uploading` overlay + spinner) and a remove control.
 *
 * Mirrors React's `AttachmentQueue` from `@copilotkit/react-ui`. The queue
 * container and the per-item view can each be overridden via either a
 * content-projected template (`#container`, `#item`) or a `*Component` input.
 */
@Component({
  standalone: true,
  selector: "copilot-chat-attachment-queue",
  host: { "data-copilotkit": "" },
  imports: [
    CommonModule,
    CopilotSlot,
    CopilotChatAttachmentQueueContainer,
    CopilotChatAttachmentQueueItem,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (entries().length > 0) {
      @if (containerTemplate || containerComponent()) {
        <copilot-slot
          [slot]="containerTemplate || containerComponent()"
          [context]="containerContext()"
          [defaultComponent]="DefaultContainerComponent"
        >
          <ng-container *ngTemplateOutlet="itemsTemplate"></ng-container>
        </copilot-slot>
      } @else {
        <copilot-chat-attachment-queue-container [inputClass]="inputClass()">
          <ng-container *ngTemplateOutlet="itemsTemplate"></ng-container>
        </copilot-chat-attachment-queue-container>
      }
    }

    <ng-template #itemsTemplate>
      @for (entry of entries(); track entry.key) {
        @if (itemTemplate || itemComponent()) {
          <copilot-slot
            [slot]="itemTemplate || itemComponent()"
            [context]="entry.context"
            [defaultComponent]="DefaultItemComponent"
          ></copilot-slot>
        } @else {
          <copilot-chat-attachment-queue-item
            [attachment]="entry.attachment"
            [src]="entry.context.src"
            [isUploading]="entry.context.isUploading"
            [clickHandler]="entry.context.clickHandler"
          ></copilot-chat-attachment-queue-item>
        }
      }
    </ng-template>
  `,
})
export class CopilotChatAttachmentQueue {
  @ContentChild("container", { read: TemplateRef })
  containerTemplate?: TemplateRef<AttachmentQueueContainerContext>;
  @ContentChild("item", { read: TemplateRef })
  itemTemplate?: TemplateRef<AttachmentQueueItemContext>;

  readonly attachments = input<Attachment[]>([]);
  readonly inputClass = input<string | undefined>(undefined);

  readonly containerComponent = input<Type<unknown> | undefined>(undefined);
  readonly itemComponent = input<Type<unknown> | undefined>(undefined);

  readonly removeAttachment = output<AttachmentQueueRemoveEvent>();

  protected readonly DefaultContainerComponent =
    CopilotChatAttachmentQueueContainer;
  protected readonly DefaultItemComponent = CopilotChatAttachmentQueueItem;

  readonly entries = computed<AttachmentQueueEntry[]>(() => {
    return this.attachments().map((attachment) => {
      const isUploading = attachment.status === "uploading";
      const src = isUploading ? "" : getSourceUrl(attachment.source);
      const context: AttachmentQueueItemContext = {
        attachment,
        isUploading,
        src,
        clickHandler: () => this.handleRemove(attachment),
      };
      return { key: attachment.id, attachment, context };
    });
  });

  readonly containerContext = computed<AttachmentQueueContainerContext>(() => ({
    attachments: this.attachments(),
    inputClass: this.inputClass(),
  }));

  handleRemove(attachment: Attachment): void {
    this.removeAttachment.emit({ id: attachment.id, attachment });
  }
}
