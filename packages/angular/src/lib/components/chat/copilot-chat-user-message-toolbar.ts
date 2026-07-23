import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";

import { cn } from "../../utils";

@Component({
  selector: "div[copilotChatUserMessageToolbar]",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <ng-content></ng-content>
  `,
  host: {
    "[class]": "computedClass()",
  },
})
export class CopilotChatUserMessageToolbar {
  readonly inputClass = input<string | undefined>();

  readonly computedClass = computed(() =>
    cn(
      "cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:justify-end cpk:mt-[4px] cpk:invisible cpk:group-hover:visible",
      this.inputClass(),
    ),
  );
}
