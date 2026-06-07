import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";

import { cn } from "../../utils";

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
  styles: [],
})
export class CopilotChatToolbar {
  readonly inputClass = input<string | undefined>();

  readonly computedClass = computed(() => {
    const baseClasses =
      "cpk:w-full cpk:h-[60px] cpk:bg-transparent cpk:flex cpk:items-center cpk:justify-between";
    return cn(baseClasses, this.inputClass());
  });
}
