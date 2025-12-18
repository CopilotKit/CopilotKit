import {
  Component,
  TemplateRef,
  ViewContainerRef,
  OnInit,
  OnChanges,
  SimpleChanges,
  Inject,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  input,
  ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { renderSlot } from "./slot.utils";
import { Type } from "@angular/core";

/**
 * @internal - This component is for internal use only.
 * Simple slot component for rendering custom content or defaults.
 * Supports templates and components only.
 *
 * @example
 * ```html
 * <!-- With template -->
 * <copilot-slot [slot]="sendButtonTemplate" [context]="buttonContext">
 *   <button class="default-btn">Default</button>
 * </copilot-slot>
 * ```
 */
@Component({
  standalone: true,
  selector: "copilot-slot",
  imports: [CommonModule],
  template: `
    <!-- If slot template provided, render it -->
    @if (slot() && isTemplate(slot)) {
      <ng-container
        [ngTemplateOutlet]="slot"
        [ngTemplateOutletContext]="context || {}"
      >
      </ng-container>
    }

    <!-- If not a template, we'll handle in code -->
    <ng-container #slotContainer></ng-container>

    <!-- Default content (only shown if no slot) -->
    @if (!slot && !defaultComponent) {
      <ng-content></ng-content>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopilotSlot implements OnInit, OnChanges {
  slot = input<TemplateRef<any> | Type<any> | undefined>(undefined);
  context = input<any | undefined>(undefined);
  defaultComponent = input<Type<any> | undefined>(undefined);
  outputs = input<Record<string, (event: any) => void> | undefined>(undefined);

  @ViewChild("slotContainer", { read: ViewContainerRef, static: true })
  private slotContainer!: ViewContainerRef;

  private componentRef?: any;

  constructor(
    @Inject(ViewContainerRef) private viewContainer: ViewContainerRef,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.renderSlot();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["slot"]) {
      // Slot changed, need to re-render completely
      this.renderSlot();
    } else if (changes["context"] && this.componentRef) {
      // Just context changed, update existing component
      this.updateComponentProps();
      this.cdr.detectChanges();
    } else if (changes["context"]) {
      // No component ref yet, render the slot
      this.renderSlot();
    }
  }

  isTemplate(value: any): value is TemplateRef<any> {
    return value instanceof TemplateRef;
  }

  private renderSlot(): void {
    // Skip if it's a template (handled by ngTemplateOutlet)
    if (this.slot() && this.isTemplate(this.slot())) {
      this.componentRef = null;
      return;
    }

    // Clear previous content
    this.slotContainer.clear();
    this.componentRef = null;

    // Skip if no slot and no default component
    if (!this.slot() && !this.defaultComponent()) {
      return;
    }

    // Use the utility to render other slot types
    if (this.slot() || this.defaultComponent()) {
      this.componentRef = renderSlot(this.slotContainer, {
        slot: this.slot(),
        defaultComponent: this.defaultComponent()!,
        props: this.context(),
        outputs: this.outputs(),
      });
    }
  }

  private updateComponentProps(): void {
    if (!this.componentRef || !this.componentRef.instance) {
      return;
    }

    const props = this.context();

    // Update props using setInput, only for declared inputs
    if (props) {
      const ctor = this.componentRef.instance.constructor as any;
      const cmpDef: any = ctor?.ɵcmp;
      const declaredInputs = new Set<string>(Object.keys(cmpDef?.inputs ?? {}));

      if (declaredInputs.has("props")) {
        this.componentRef.setInput("props", props);
      } else {
        for (const key in props) {
          if (declaredInputs.has(key)) {
            const value = props[key];
            this.componentRef.setInput(key, value);
          }
        }
      }
    }

    // Trigger change detection
    if (this.componentRef.changeDetectorRef) {
      this.componentRef.changeDetectorRef.detectChanges();
    }
  }
}
