import { Component } from "@angular/core";
import { AudioPlayerApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIBasicComponent } from "./basic-component";

@Component({
  selector: "copilot-a2ui-audio-player",
  template: `
    @if (props().description) {
      <span class="description">{{ props().description }}</span>
    }
    <audio class="audio" controls [src]="props().url ?? ''"></audio>
  `,
  styles: `
    :host {
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
      box-sizing: border-box;
    }
  `,
})
export class CopilotA2UIAudioPlayer extends CopilotA2UIBasicComponent<
  typeof AudioPlayerApi
> {}
