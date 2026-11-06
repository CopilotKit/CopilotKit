import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  computed,
} from "@angular/core";

import { cn } from "../../utils";

@Component({
  selector: "copilot-chat-user-message-renderer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    "[class]": "computedClass()",
  },
  // No whitespace around the content: the bubble keeps it (pre-wrap).
  template: `
    {{ content() }}
  `,
})
export class CopilotChatUserMessageRenderer {
  readonly content = input<string>("");
  readonly inputClass = input<string | undefined>();

  readonly computedClass = computed(() => {
    return cn("cpk-user-message-bubble", this.inputClass());
  });
}
