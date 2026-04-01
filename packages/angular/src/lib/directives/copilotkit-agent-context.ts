import {
  Directive,
  Input,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  Inject,
} from "@angular/core";
import { CopilotKit } from "../copilotkit";
import type { Context } from "@ag-ui/client";

/**
 * Directive to manage agent context in CopilotKit.
 * Automatically adds context on init, updates on changes, and removes on destroy.
 *
 * @example
 * ```html
 * <!-- With separate inputs -->
 * <div copilotkitAgentContext
 *      [description]="'User preferences'"
 *      [value]="userSettings">
 * </div>
 *
 * <!-- With context object -->
 * <div [copilotkitAgentContext]="contextObject">
 * </div>
 *
 * <!-- With dynamic values -->
 * <div copilotkitAgentContext
 *      description="Form state"
 *      [value]="formData$ | async">
 * </div>
 * ```
 */
@Directive({
  selector: "[copilotkitAgentContext]",
  standalone: true,
})
export class CopilotKitAgentContext implements OnInit, OnChanges, OnDestroy {
  private contextId?: string;

  constructor(@Inject(CopilotKit) private readonly copilotkit: CopilotKit) {}

  /**
   * Context object containing both description and value.
   * If provided, this takes precedence over individual inputs.
   */
  @Input("copilotkitAgentContext") context?: Context;

  /**
   * Description of the context.
   * Used when context object is not provided.
   */
  @Input() description?: string;

  /**
   * Value of the context.
   * Used when context object is not provided.
   */
  @Input() value?: any;

  ngOnInit(): void {
    this.addContext();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Check if any relevant input has changed
    const hasContextChange = "context" in changes;
    const hasDescriptionChange = "description" in changes;
    const hasValueChange = "value" in changes;

    if (hasContextChange || hasDescriptionChange || hasValueChange) {
      // Skip the first change as ngOnInit handles initial setup
      if (this.contextId) {
        this.updateContext();
      }
    }
  }

  ngOnDestroy(): void {
    this.removeContext();
  }

  /**
   * Adds the context to CopilotKit
   */
  private addContext(): void {
    const contextToAdd = this.getContext();

    if (contextToAdd) {
      this.contextId = this.copilotkit.core.addContext(contextToAdd);
    }
  }

  /**
   * Updates the context by removing the old one and adding a new one
   */
  private updateContext(): void {
    this.removeContext();
    this.addContext();
  }

  /**
   * Removes the current context from CopilotKit
   */
  private removeContext(): void {
    if (this.contextId) {
      this.copilotkit.core.removeContext(this.contextId);
      this.contextId = undefined;
    }
  }

  /**
   * Gets the context object from inputs
   */
  private getContext(): Context | null {
    // If context object is provided, use it
    if (this.context) {
      return this.context;
    }

    // Otherwise, build from individual inputs
    // Note: null is a valid value, but undefined means not set
    if (this.description !== undefined && this.value !== undefined) {
      return {
        description: this.description,
        value: this.value,
      };
    }

    return null;
  }
}
