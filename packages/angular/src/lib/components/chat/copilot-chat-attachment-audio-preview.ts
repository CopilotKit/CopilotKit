import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
  ViewEncapsulation,
} from "@angular/core";
import type { Attachment } from "@copilotkit/shared";
import { formatFileSize, getSourceUrl } from "@copilotkit/shared";
import { CopilotIcon, Pause, Play } from "../icons/copilot-icon";

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Audio chip for the attachment queue: a play/pause badge driving a hidden
 * `<audio>`, with the filename above the duration (or file size until the
 * metadata loads). Mirrors React's `AudioPreview`. Internal to the queue (not
 * part of the public API).
 */
@Component({
  selector: "copilot-chat-attachment-audio-preview",
  imports: [CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="copilotKitAttachmentQueuePreviewAudio">
      <button
        type="button"
        class="copilotKitAttachmentQueueAudioButton"
        [attr.aria-label]="playing() ? 'Pause audio' : 'Play audio'"
        (click)="togglePlayback(audio)"
      >
        <copilot-icon
          [class.copilotKitAttachmentQueueAudioPlayIcon]="!playing()"
          [img]="playing() ? Pause : Play"
          [size]="14"
        />
      </button>
      <div class="copilotKitAttachmentQueueDocInfo">
        <span class="copilotKitAttachmentQueueFilename">
          {{ attachment().filename || "Audio" }}
        </span>
        @if (meta(); as meta) {
          <span class="copilotKitAttachmentQueueFileSize">{{ meta }}</span>
        }
      </div>
      <audio
        #audio
        hidden
        preload="metadata"
        [src]="src()"
        (play)="playing.set(true)"
        (pause)="playing.set(false)"
        (ended)="playing.set(false)"
        (loadedmetadata)="onLoadedMetadata(audio)"
      ></audio>
    </div>
  `,
})
export class CopilotChatAttachmentAudioPreview {
  readonly attachment = input.required<Attachment>();

  protected readonly Play = Play;
  protected readonly Pause = Pause;
  protected readonly playing = signal(false);
  private readonly duration = signal<number | null>(null);
  protected readonly src = computed(() =>
    getSourceUrl(this.attachment().source),
  );
  protected readonly meta = computed(() => {
    const duration = this.duration();
    if (duration != null) return formatDuration(duration);
    const size = this.attachment().size;
    return size != null ? formatFileSize(size) : null;
  });

  protected togglePlayback(audio: HTMLAudioElement): void {
    if (audio.paused) {
      audio.play().catch(() => this.playing.set(false));
    } else {
      audio.pause();
    }
  }

  protected onLoadedMetadata(audio: HTMLAudioElement): void {
    if (Number.isFinite(audio.duration)) this.duration.set(audio.duration);
  }
}
