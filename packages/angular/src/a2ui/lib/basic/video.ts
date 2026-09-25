import { Component, input } from "@angular/core";
import type { VideoApi } from "@a2ui/web_core/v0_9/basic_catalog";
import type { BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-video",
  template: `
    <video class="video" controls [src]="props().url ?? ''"></video>
  `,
  styles: `
    :host {
      display: contents;
    }
    .video {
      width: 100%;
      aspect-ratio: 16 / 9;
      margin: var(--a2ui-spacing-m, 8px);
      box-sizing: border-box;
    }
  `,
})
export class CopilotA2UIVideo {
  readonly props = input.required<BasicProps<typeof VideoApi>>();
}
