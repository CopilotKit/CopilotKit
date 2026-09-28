import { Component } from "@angular/core";
import { VideoApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIBasicComponent } from "./basic-component";

@Component({
  selector: "copilot-a2ui-video",
  template: `
    <video class="video" controls [src]="props().url ?? ''"></video>
  `,
  styles: `
    :host {
      display: block;
    }
    .video {
      width: 100%;
      aspect-ratio: 16 / 9;
      box-sizing: border-box;
    }
  `,
})
export class CopilotA2UIVideo extends CopilotA2UIBasicComponent<
  typeof VideoApi
> {}
