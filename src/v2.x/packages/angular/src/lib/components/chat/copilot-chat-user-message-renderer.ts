import {
  Component,
  input,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  computed,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { cn } from "../../utils";

@Component({
  selector: "copilot-chat-user-message-renderer",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    "[class]": "computedClass()",
  },
  template: `{{ content() }}`,
})
export class CopilotChatUserMessageRenderer {
  readonly content = input<string>("");
  readonly inputClass = input<string | undefined>();

  readonly computedClass = computed(() => {
    return cn(
      "prose dark:prose-invert bg-muted relative max-w-[80%] rounded-[18px] px-4 py-1.5 data-[multiline]:py-3 inline-block whitespace-pre-wrap",
      this.inputClass()
    );
  });
}
