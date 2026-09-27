import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";

import { cn } from "../../utils";

/**
 * Feather slot for CopilotChatView. Like React's, the default renders an
 * empty element: the fade above the input now lives in the input container.
 * Pass a class or component through the slot to draw your own.
 */
@Component({
  selector: "copilot-chat-view-feather",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div [class]="computedClass" [style]="style()"></div>
  `,
})
export class CopilotChatViewFeather {
  inputClass = input<string | undefined>();
  style = input<{ [key: string]: any } | undefined>();

  get computedClass(): string {
    return cn(this.inputClass());
  }
}
