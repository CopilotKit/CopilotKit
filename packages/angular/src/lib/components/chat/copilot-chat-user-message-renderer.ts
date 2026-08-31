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
  template: `
    {{ content() }}
  `,
})
export class CopilotChatUserMessageRenderer {
  readonly content = input<string>("");
  readonly inputClass = input<string | undefined>();

  readonly computedClass = computed(() => {
    return cn(
      "cpk:prose cpk:dark:prose-invert cpk:bg-muted cpk:relative cpk:max-w-[80%] cpk:rounded-[18px] cpk:px-4 cpk:py-1.5 cpk:data-[multiline]:py-3 cpk:inline-block cpk:whitespace-pre-wrap",
      this.inputClass(),
    );
  });
}
