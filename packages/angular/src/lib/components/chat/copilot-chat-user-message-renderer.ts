import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  computed,
} from "@angular/core";

import { cn } from "../../utils";
import { CopilotChatAssistantMessageRenderer } from "./copilot-chat-assistant-message-renderer";
import { prepareUserMarkdown } from "./user-markdown";

/**
 * The user's message bubble. Text renders as markdown (code, lists, emphasis,
 * links) through the same pipeline as assistant messages, while line breaks
 * stay as typed, `#` lines stay literal and pasted HTML shows as text.
 */
@Component({
  selector: "copilot-chat-user-message-renderer",
  imports: [CopilotChatAssistantMessageRenderer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    "[class]": "computedClass()",
  },
  template: `
    <copilot-chat-assistant-message-renderer
      [content]="markdown()"
      [plainHeadings]="true"
    />
  `,
})
export class CopilotChatUserMessageRenderer {
  readonly content = input<string>("");
  readonly inputClass = input<string | undefined>();

  protected readonly markdown = computed(() =>
    prepareUserMarkdown(this.content()),
  );

  readonly computedClass = computed(() => {
    return cn(
      "cpk:prose cpk:dark:prose-invert cpk:bg-muted cpk:text-foreground cpk:relative cpk:max-w-[80%] cpk:min-w-0 cpk:rounded-2xl cpk:px-4 cpk:py-2 cpk:inline-block cpk:break-words",
      this.inputClass(),
    );
  });
}
