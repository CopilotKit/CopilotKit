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
 * The user's message bubble. By default text renders as markdown (code, lists,
 * emphasis, links) through the same pipeline as assistant messages, while line
 * breaks stay as typed, `#` lines stay literal and pasted HTML shows as text.
 * With `markdown` off it shows the plain text, as typed.
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
    @if (markdown()) {
      <copilot-chat-assistant-message-renderer
        [content]="markdownContent()"
        [plainHeadings]="true"
      />
    } @else {
      <!-- The container keeps template whitespace out of the pre-wrap text. -->
      <ng-container>{{ content() }}</ng-container>
    }
  `,
})
export class CopilotChatUserMessageRenderer {
  readonly content = input<string>("");
  readonly inputClass = input<string | undefined>();
  /**
   * Render the text as markdown. Defaults to `true`; set `false` for plain
   * text with line breaks kept as typed.
   */
  readonly markdown = input<boolean>(true);

  protected readonly markdownContent = computed(() =>
    prepareUserMarkdown(this.content()),
  );

  readonly computedClass = computed(() => {
    return cn(
      "cpk:prose cpk:dark:prose-invert cpk:bg-muted cpk:text-foreground cpk:relative cpk:max-w-[80%] cpk:min-w-0 cpk:rounded-2xl cpk:px-4 cpk:py-2 cpk:inline-block cpk:break-words",
      !this.markdown() && "cpk:whitespace-pre-wrap",
      this.inputClass(),
    );
  });
}
