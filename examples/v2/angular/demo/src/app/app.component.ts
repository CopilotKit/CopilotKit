import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { HeadlessChatComponent } from "./routes/headless/headless-chat.component";
import { CustomInputChatComponent } from "./routes/custom-input/custom-input-chat.component";
import { DefaultChatComponent } from "./routes/default/default-chat.component";
import { CoPilotPortComponent } from "./routes/ukg-port/co-pilot-port.component";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule,
    HeadlessChatComponent,
    CustomInputChatComponent,
    DefaultChatComponent,
    CoPilotPortComponent,
  ],
  template: `
    <div
      style="height: 100vh; width: 100vw; margin: 0; padding: 0; overflow: hidden; display: block;"
    >
      <ng-container *ngIf="isHeadless">
        <headless-chat></headless-chat>
      </ng-container>
      <ng-container *ngIf="isCustomInput">
        <nextgen-custom-input-chat></nextgen-custom-input-chat>
      </ng-container>
      <ng-container *ngIf="!isHeadless && !isCustomInput && !isUkgPort">
        <default-chat></default-chat>
      </ng-container>
      <ng-container *ngIf="isUkgPort">
        <ukg-co-pilot-port></ukg-co-pilot-port>
      </ng-container>
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
