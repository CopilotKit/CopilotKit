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
      "cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:justify-end cpk:-mr-1 cpk:mt-1 cpk:opacity-0 cpk:transition-opacity cpk:duration-150 cpk:group-hover:opacity-100 cpk:focus-within:opacity-100",
      this.inputClass(),
    ),
  );
}
