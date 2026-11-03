import {
  Component,
  input,
  output,
  ElementRef,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  PLATFORM_ID,
  afterNextRender,
  afterRenderEffect,
  untracked,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import {
  ɵCOMPOSER_DEFAULT_MAX_ROWS,
  ɵfitTextareaHeight,
  ɵmeasureTextarea,
} from "@copilotkit/core";
import type { ɵTextareaMetrics } from "@copilotkit/core";
import { cn } from "../../utils";
import { injectChatLabels } from "../../chat-config";
import { injectChatState } from "../../chat-state";

@Component({
  selector: "textarea[copilotChatTextarea]",
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
    "[attr.data-testid]": "'copilot-chat-textarea'",
    "(input)": "onInput($event)",
    "(keydown)": "onKeyDown($event)",
    "[attr.rows]": "1",
  },
  template: "",
  styles: [],
})
export class CopilotChatTextarea {
  private elementRef = inject(ElementRef<HTMLTextAreaElement>);
  private platformId = inject(PLATFORM_ID);
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
    () => this.inputValue() ?? this.chatState.inputValue() ?? "",
  );
  placeholder = computed(
    () => this.inputPlaceholder() || this.chatLabels.chatInputPlaceholder,
  );
  disabled = computed(() => this.inputDisabled() ?? false);

  computedClass = computed(() => {
    return cn("cpk-chat-input-textarea", this.inputClass());
  });

  constructor() {
    afterNextRender(() => {
      if (this.inputAutoFocus() ?? true) {
        this.elementRef.nativeElement.focus();
      }
    });
    // Measure again whenever `inputMaxRows` changes, not only once.
    afterRenderEffect(() => {
      this.inputMaxRows();
      untracked(() => {
        this.calculateMaxHeight();
        this.adjustHeight();
      });
    });
  }

  onInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    const newValue = textarea.value;
    this.valueChange.emit(newValue);

    this.chatState.changeInput(newValue);

    this.adjustHeight();
  }

  /**
   * Passes every key press to `keyDown`. The chat input decides what Enter
   * does (send, stop, or nothing during IME composition) and prevents the
   * line break itself.
   */
  onKeyDown(event: KeyboardEvent): void {
    this.keyDown.emit(event);
  }

  private metrics: ɵTextareaMetrics | null = null;

  /** Measures one row and the height of `inputMaxRows` rows. */
  private calculateMaxHeight(): void {
    const maxRows = this.inputMaxRows() ?? ɵCOMPOSER_DEFAULT_MAX_ROWS;
    this.metrics = ɵmeasureTextarea(this.elementRef.nativeElement, maxRows);
    this.maxHeight.set(this.metrics.maxHeight);
  }

  private adjustHeight(): number {
    return ɵfitTextareaHeight(this.elementRef.nativeElement, this.maxHeight());
  }

  /**
   * Fits the height to the text and returns the text's height and the height
   * of one line, for the input to choose its layout.
   */
  measure(): { scrollHeight: number; singleLineHeight: number } {
    if (!isPlatformBrowser(this.platformId)) {
      return { scrollHeight: 0, singleLineHeight: 0 };
    }
    if (!this.metrics?.singleLineHeight) this.calculateMaxHeight();
    return {
      scrollHeight: this.adjustHeight(),
      singleLineHeight: this.metrics?.singleLineHeight ?? 0,
    };
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
