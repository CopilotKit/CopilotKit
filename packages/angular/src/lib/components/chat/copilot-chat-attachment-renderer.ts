import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  ContentChild,
  TemplateRef,
  Type,
  computed,
  input,
  signal,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { getDocumentIcon, getSourceUrl } from "@copilotkit/shared";
import { CopilotSlot } from "../../slots/copilot-slot";
import { cn } from "../../utils";
import type {
  AttachmentModality,
  AttachmentRendererSlotContext,
  InputContentSource,
} from "./copilot-chat-attachment-renderer.types";

const containerImageBase = "relative overflow-hidden rounded-md";
const imageElementBase = "block max-h-80 max-w-full object-contain";
const audioBase = "flex flex-col gap-1";
const videoBase = "flex flex-col gap-1";
const documentBase =
  "flex items-center gap-2 rounded-md border border-border/60 bg-background p-2";
const documentIconBase =
  "flex h-9 w-9 items-center justify-center rounded-md bg-muted text-[10px] font-semibold uppercase text-muted-foreground";
const documentInfoBase = "flex min-w-0 flex-col";
const filenameBase = "truncate text-xs font-medium text-foreground";
const errorBase =
  "flex items-center justify-center rounded-md border border-border/60 bg-muted p-3 text-xs text-muted-foreground";

/**
 * Default image attachment renderer.
 * Shows an inline error placeholder if the image fails to load.
 */
@Component({
  standalone: true,
  selector: "copilot-chat-attachment-image",
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (errored()) {
      <div data-copilotkit [class]="errorClass()">Failed to load image</div>
    } @else {
      <div data-copilotkit [class]="containerClass()">
        <img
          [src]="src()"
          [alt]="filename() || 'Image attachment'"
          [class]="imageClass"
          (error)="handleError()"
        />
      </div>
    }
  `,
})
export class CopilotChatAttachmentImage {
  readonly src = input<string>("");
  readonly filename = input<string | undefined>(undefined);
  readonly inputClass = input<string | undefined>(undefined);

  protected readonly errored = signal(false);
  protected readonly imageClass = imageElementBase;

  readonly containerClass = computed(() =>
    cn(containerImageBase, this.inputClass()),
  );
  readonly errorClass = computed(() => cn(errorBase, this.inputClass()));

  handleError(): void {
    this.errored.set(true);
  }
}

@Component({
  standalone: true,
  selector: "copilot-chat-attachment-audio",
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div data-copilotkit [class]="containerClass()">
      <audio [src]="src()" controls preload="metadata"></audio>
      @if (filename()) {
        <span [class]="filenameClass">{{ filename() }}</span>
      }
    </div>
  `,
})
export class CopilotChatAttachmentAudio {
  readonly src = input<string>("");
  readonly filename = input<string | undefined>(undefined);
  readonly inputClass = input<string | undefined>(undefined);

  protected readonly filenameClass = filenameBase;

  readonly containerClass = computed(() => cn(audioBase, this.inputClass()));
}

@Component({
  standalone: true,
  selector: "copilot-chat-attachment-video",
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div data-copilotkit [class]="containerClass()">
      <video [src]="src()" controls preload="metadata"></video>
    </div>
  `,
})
export class CopilotChatAttachmentVideo {
  readonly src = input<string>("");
  readonly inputClass = input<string | undefined>(undefined);

  readonly containerClass = computed(() => cn(videoBase, this.inputClass()));
}

@Component({
  standalone: true,
  selector: "copilot-chat-attachment-document",
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div data-copilotkit [class]="containerClass()">
      <div [class]="iconClass">{{ icon() }}</div>
      <div [class]="infoClass">
        <span [class]="filenameClass">{{ displayName() }}</span>
      </div>
    </div>
  `,
})
export class CopilotChatAttachmentDocument {
  readonly source = input.required<InputContentSource>();
  readonly filename = input<string | undefined>(undefined);
  readonly inputClass = input<string | undefined>(undefined);

  protected readonly iconClass = documentIconBase;
  protected readonly infoClass = documentInfoBase;
  protected readonly filenameClass = filenameBase;

  readonly containerClass = computed(() =>
    cn(documentBase, this.inputClass()),
  );

  readonly icon = computed(() => getDocumentIcon(this.source().mimeType ?? ""));

  readonly displayName = computed(
    () => this.filename() || this.source().mimeType || "Unknown type",
  );
}

/**
 * Renders a single chat attachment by modality.
 *
 * Mirrors React's `AttachmentRenderer` from `@copilotkit/react-ui`. Resolves
 * the URL once via `getSourceUrl(source)` and dispatches to a per-modality
 * default component. Each modality can be overridden via either a content-
 * projected template (`#imageRenderer`, `#audioRenderer`, `#videoRenderer`,
 * `#documentRenderer`) or a `*Component` input.
 */
@Component({
  standalone: true,
  selector: "copilot-chat-attachment-renderer",
  host: { "data-copilotkit": "" },
  imports: [
    CommonModule,
    CopilotSlot,
    CopilotChatAttachmentImage,
    CopilotChatAttachmentAudio,
    CopilotChatAttachmentVideo,
    CopilotChatAttachmentDocument,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @switch (type()) {
      @case ("image") {
        @if (imageRendererTemplate || imageRendererComponent()) {
          <copilot-slot
            [slot]="imageRendererTemplate || imageRendererComponent()"
            [context]="slotContext()"
            [defaultComponent]="DefaultImageComponent"
          ></copilot-slot>
        } @else {
          <copilot-chat-attachment-image
            [src]="src()"
            [filename]="filename()"
            [inputClass]="inputClass()"
          ></copilot-chat-attachment-image>
        }
      }
      @case ("audio") {
        @if (audioRendererTemplate || audioRendererComponent()) {
          <copilot-slot
            [slot]="audioRendererTemplate || audioRendererComponent()"
            [context]="slotContext()"
            [defaultComponent]="DefaultAudioComponent"
          ></copilot-slot>
        } @else {
          <copilot-chat-attachment-audio
            [src]="src()"
            [filename]="filename()"
            [inputClass]="inputClass()"
          ></copilot-chat-attachment-audio>
        }
      }
      @case ("video") {
        @if (videoRendererTemplate || videoRendererComponent()) {
          <copilot-slot
            [slot]="videoRendererTemplate || videoRendererComponent()"
            [context]="slotContext()"
            [defaultComponent]="DefaultVideoComponent"
          ></copilot-slot>
        } @else {
          <copilot-chat-attachment-video
            [src]="src()"
            [inputClass]="inputClass()"
          ></copilot-chat-attachment-video>
        }
      }
      @case ("document") {
        @if (documentRendererTemplate || documentRendererComponent()) {
          <copilot-slot
            [slot]="documentRendererTemplate || documentRendererComponent()"
            [context]="slotContext()"
            [defaultComponent]="DefaultDocumentComponent"
          ></copilot-slot>
        } @else {
          <copilot-chat-attachment-document
            [source]="source()"
            [filename]="filename()"
            [inputClass]="inputClass()"
          ></copilot-chat-attachment-document>
        }
      }
    }
  `,
})
export class CopilotChatAttachmentRenderer {
  @ContentChild("imageRenderer", { read: TemplateRef })
  imageRendererTemplate?: TemplateRef<AttachmentRendererSlotContext>;
  @ContentChild("audioRenderer", { read: TemplateRef })
  audioRendererTemplate?: TemplateRef<AttachmentRendererSlotContext>;
  @ContentChild("videoRenderer", { read: TemplateRef })
  videoRendererTemplate?: TemplateRef<AttachmentRendererSlotContext>;
  @ContentChild("documentRenderer", { read: TemplateRef })
  documentRendererTemplate?: TemplateRef<AttachmentRendererSlotContext>;

  readonly type = input.required<AttachmentModality>();
  readonly source = input.required<InputContentSource>();
  readonly filename = input<string | undefined>(undefined);
  readonly inputClass = input<string | undefined>(undefined);

  readonly imageRendererComponent = input<Type<unknown> | undefined>(undefined);
  readonly audioRendererComponent = input<Type<unknown> | undefined>(undefined);
  readonly videoRendererComponent = input<Type<unknown> | undefined>(undefined);
  readonly documentRendererComponent = input<Type<unknown> | undefined>(
    undefined,
  );

  protected readonly DefaultImageComponent = CopilotChatAttachmentImage;
  protected readonly DefaultAudioComponent = CopilotChatAttachmentAudio;
  protected readonly DefaultVideoComponent = CopilotChatAttachmentVideo;
  protected readonly DefaultDocumentComponent = CopilotChatAttachmentDocument;

  /**
   * Resolved URL for the current `source`. Mirrors React's call to
   * `getSourceUrl(source)` — for `data` sources this is a base64 data URL,
   * for `url` sources this is the URL itself.
   */
  readonly src = computed(() => getSourceUrl(this.source()));

  /**
   * Context shared with all per-modality slot overrides.
   */
  readonly slotContext = computed<AttachmentRendererSlotContext>(() => ({
    type: this.type(),
    source: this.source(),
    src: this.src(),
    filename: this.filename(),
    inputClass: this.inputClass(),
  }));
}
