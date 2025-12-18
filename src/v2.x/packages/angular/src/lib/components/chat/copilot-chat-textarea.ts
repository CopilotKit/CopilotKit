import {
  Component,
  input,
  output,
  ElementRef,
  AfterViewInit,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";
import { cn } from "../../utils";
import { injectChatLabels } from "../../chat-config";
import { injectChatState } from "../../chat-state";

@Component({
  selector: "textarea[copilotChatTextarea]",
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    "[value]": "computedValue()",
    "[placeholder]": "placeholder()",
    "[disabled]": "disabled()",
    "[class]": "computedClass()",
    "[style.max-height.px]": "maxHeight()",
    "[style.overflow]": "'auto'",
    "[style.resize]": "'none'",
    "(input)": "onInput($event)",
    "(keydown)": "onKeyDown($event)",
    "[attr.rows]": "1",
  },
  template: "",
  styles: [],
})
export class CopilotChatTextarea implements AfterViewInit {
  private elementRef = inject(ElementRef<HTMLTextAreaElement>);
  get textareaRef() {
    return this.elementRef;
  }

  inputValue = input<string | undefined>();
  inputPlaceholder = input<string | undefined>();
  inputMaxRows = input<number | undefined>();
  inputAutoFocus = input<boolean | undefined>();
  inputDisabled = input<boolean | undefined>();
  inputClass = input<string | undefined>();

  valueChange = output<string>();
  keyDown = output<KeyboardEvent>();

  readonly chatLabels = injectChatLabels();
  readonly chatState = injectChatState();

  // Internal signals
  maxHeight = signal<number>(0);

  // Computed values
  computedValue = computed(
    () => this.inputValue() ?? this.chatState.inputValue() ?? ""
  );
  placeholder = computed(
    () => this.inputPlaceholder() || this.chatLabels.chatInputPlaceholder
  );
  disabled = computed(() => this.inputDisabled() ?? false);

  computedClass = computed(() => {
    const baseClasses = cn(
      // Layout and sizing
      "w-full p-5 pb-0",
      // Behavior
      "outline-none resize-none",
      // Background
      "bg-transparent",
      // Typography
      "antialiased font-regular leading-relaxed text-[16px]",
      // Placeholder styles
      "placeholder:text-[#00000077] dark:placeholder:text-[#fffc]"
    );
    return cn(baseClasses, this.inputClass());
  });

  constructor() {}

  ngAfterViewInit(): void {
    this.calculateMaxHeight();
    this.adjustHeight();

    if (this.inputAutoFocus() ?? true) {
      setTimeout(() => {
        this.elementRef.nativeElement.focus();
      });
    }
  }

  onInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    const newValue = textarea.value;
    this.valueChange.emit(newValue);

    this.chatState.changeInput(newValue);

    this.adjustHeight();
  }

  onKeyDown(event: KeyboardEvent): void {
    // Check for Enter key without Shift
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.keyDown.emit(event);
    } else {
      this.keyDown.emit(event);
    }
  }

  private calculateMaxHeight(): void {
    const textarea = this.elementRef.nativeElement;
    const maxRowsValue = this.inputMaxRows() ?? 5;

    // Save current value
    const currentValue = textarea.value;

    // Clear content to measure single row height
    textarea.value = "";
    textarea.style.height = "auto";

    // Get computed styles to account for padding
    const computedStyle = window.getComputedStyle(textarea);
    const paddingTop = parseFloat(computedStyle.paddingTop);
    const paddingBottom = parseFloat(computedStyle.paddingBottom);

    // Calculate actual content height (without padding)
    const contentHeight = textarea.scrollHeight - paddingTop - paddingBottom;

    // Calculate max height: content height for maxRows + padding
    const calculatedMaxHeight =
      contentHeight * maxRowsValue + paddingTop + paddingBottom;
    this.maxHeight.set(calculatedMaxHeight);

    // Restore original value
    textarea.value = currentValue;

    // Adjust height after calculating maxHeight
    if (currentValue) {
      this.adjustHeight();
    }
  }

  private adjustHeight(): void {
    const textarea = this.elementRef.nativeElement;
    const maxHeightValue = this.maxHeight();

    if (maxHeightValue > 0) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeightValue)}px`;
    }
  }

  /**
   * Public method to focus the textarea
   */
  focus(): void {
    this.elementRef.nativeElement.focus();
  }

  /**
   * Public method to get current value
   */
  getValue(): string {
    return this.elementRef.nativeElement.value;
  }

  /**
   * Public method to set value programmatically
   */
  setValue(value: string): void {
    this.elementRef.nativeElement.value = value;
    this.valueChange.emit(value);

    this.chatState.changeInput(value);

    setTimeout(() => this.adjustHeight());
  }
}
