import { Component } from "@angular/core";

import { HeadlessChatComponent } from "./routes/headless/headless-chat.component";
import { CustomInputChatComponent } from "./routes/custom-input/custom-input-chat.component";
import { DefaultChatComponent } from "./routes/default/default-chat.component";
import { CoPilotPortComponent } from "./routes/ukg-port/co-pilot-port.component";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    HeadlessChatComponent,
    CustomInputChatComponent,
    DefaultChatComponent,
    CoPilotPortComponent,
  ],
  template: `
    <div
      style="
        height: 100vh;
        width: 100vw;
        margin: 0;
        padding: 0;
        overflow: hidden;
        display: block;
      "
    >
      @if (isHeadless) {
        <headless-chat />
      }
      @if (isCustomInput) {
        <nextgen-custom-input-chat />
      }
      @if (!isHeadless && !isCustomInput && !isUkgPort) {
        <default-chat />
      }
      @if (isUkgPort) {
        <ukg-co-pilot-port />
      }
    </div>
  `,
})
export class AppComponent {
  isHeadless =
    typeof window !== "undefined" &&
    window.location?.pathname.startsWith("/headless");
  isCustomInput =
    typeof window !== "undefined" &&
    window.location?.pathname.startsWith("/custom-input");
  isUkgPort =
    typeof window !== "undefined" &&
    window.location?.pathname.startsWith("/ukg-port");
}
