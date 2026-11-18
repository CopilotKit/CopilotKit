import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";

import { cn } from "../../utils";
import { hostStyles } from "../host-styles";

@Component({
  selector: "div[copilotChatToolbar]",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    "[class]": "computedClass()",
  },
  template: `
    <ng-content></ng-content>
  `,
  styles: [hostStyles],
})
export class CopilotChatToolbar {
  readonly inputClass = input<string | undefined>();

  readonly computedClass = computed(() => {
    return cn("copilot-chat-toolbar", this.inputClass());
  });
}
