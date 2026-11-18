import { Directive, input, computed } from "@angular/core";
import { cn } from "../../utils";

@Directive({
  selector: "[copilotChatAssistantMessageToolbar]",
  host: {
    "[class]": "computedClass()",
  },
})
export class CopilotChatAssistantMessageToolbar {
  readonly inputClass = input<string | undefined>();

  readonly computedClass = computed(() => {
    return cn("cpk-assistant-message-toolbar", this.inputClass());
  });
}
