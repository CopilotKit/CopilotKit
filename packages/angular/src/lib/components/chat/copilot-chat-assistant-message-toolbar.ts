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
    return cn(
      "cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:-ml-[5px] cpk:-mt-[0px]",
      this.inputClass(),
    );
  });
}
