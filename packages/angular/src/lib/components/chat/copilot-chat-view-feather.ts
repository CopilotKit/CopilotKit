import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";

/**
 * Feather slot for CopilotChatView, between the messages and the input. Like
 * React's, the default renders an empty element: pass a class or a component
 * to draw a fade.
 */
@Component({
  selector: "copilot-chat-view-feather",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div [class]="inputClass()" [style]="style()"></div>
  `,
})
export class CopilotChatViewFeather {
  inputClass = input<string | undefined>();
  style = input<{ [key: string]: any } | undefined>();
}
