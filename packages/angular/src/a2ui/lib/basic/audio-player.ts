import { Component, input } from "@angular/core";
import type { AudioPlayerApi } from "@a2ui/web_core/v0_9/basic_catalog";
import type { BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-audio-player",
  template: `
    <div class="audio-player">
      @if (props().description) {
        <span class="description">{{ props().description }}</span>
      }
      <audio class="audio" controls [src]="props().url ?? ''"></audio>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .audio-player {
      display: flex;
      flex-direction: column;
      gap: calc(var(--a2ui-spacing-m, 8px) / 2);
      width: 100%;
    }
    .description {
      font-size: var(--a2ui-font-size-xs, 12px);
      color: var(--a2ui-color-muted, #666);
    }
    .audio {
      width: 100%;
      margin: var(--a2ui-spacing-m, 8px);
      box-sizing: border-box;
    }
  `,
})
export class CopilotA2UIAudioPlayer {
  readonly props = input.required<BasicProps<typeof AudioPlayerApi>>();
}
