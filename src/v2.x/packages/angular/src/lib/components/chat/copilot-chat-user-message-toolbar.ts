import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { cn } from "../../utils";

@Component({
  selector: "div[copilotChatUserMessageToolbar]",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: ` <ng-content></ng-content> `,
  host: {
    "[class]": "computedClass()",
  },
})
export class CopilotChatUserMessageToolbar {
  readonly inputClass = input<string | undefined>();

  readonly computedClass = computed(() =>
    cn(
      "w-full bg-transparent flex items-center justify-end mt-[4px] invisible group-hover:visible",
      this.inputClass()
    )
  );
}
