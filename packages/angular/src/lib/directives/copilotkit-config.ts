import {
  Directive,
  Inject,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
} from "@angular/core";
import { AbstractAgent } from "@ag-ui/client";
import { CopilotKit } from "../copilotkit";
import { CopilotKitConfig } from "../config";

/**
 * Template-form directive for configuring CopilotKit at runtime.
 *
 * `provideCopilotKit({...})` must already be present in the injector tree
 * (typically at app bootstrap). This directive forwards inputs to
 * `CopilotKit.updateRuntime(...)` so config can be driven from a template
 * the way React's `<CopilotKit runtimeUrl=... headers=...>` works.
 *
 * @example
 * ```html
 * <!-- With a single config object -->
 * <div [copilotkitConfig]="{ runtimeUrl: 'https://api.example.com' }">
 *   <copilot-chat></copilot-chat>
 * </div>
 *
 * <!-- With individual inputs -->
 * <div copilotkitConfig
 *      [runtimeUrl]="runtimeUrl"
 *      [headers]="headers"
 *      [properties]="properties">
 *   <copilot-chat></copilot-chat>
 * </div>
 * ```
 */
@Directive({
  selector: "[copilotkitConfig]",
  standalone: true,
})
export class CopilotKitConfigDirective implements OnInit, OnChanges {
  constructor(@Inject(CopilotKit) private readonly copilotkit: CopilotKit) {}

  /**
   * Optional config object. When provided, fields here override individual
   * inputs of the same name.
   */
  @Input("copilotkitConfig") config?: Partial<CopilotKitConfig>;

  @Input() runtimeUrl?: string;
  @Input() headers?: Record<string, string>;
  @Input() properties?: Record<string, unknown>;
  @Input() agents?: Record<string, AbstractAgent>;
  @Input() selfManagedAgents?: Record<string, AbstractAgent>;

  ngOnInit(): void {
    this.applyConfig();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.applyConfig();
  }

  private applyConfig(): void {
    const merged = this.resolveConfig();
    if (this.isEmpty(merged)) {
      return;
    }
    this.copilotkit.updateRuntime(merged);
  }

  private resolveConfig(): {
    runtimeUrl?: string;
    headers?: Record<string, string>;
    properties?: Record<string, unknown>;
    agents?: Record<string, AbstractAgent>;
    selfManagedAgents?: Record<string, AbstractAgent>;
  } {
    return {
      runtimeUrl: this.config?.runtimeUrl ?? this.runtimeUrl,
      headers: this.config?.headers ?? this.headers,
      properties: this.config?.properties ?? this.properties,
      agents: this.config?.agents ?? this.agents,
      selfManagedAgents:
        this.config?.selfManagedAgents ?? this.selfManagedAgents,
    };
  }

  private isEmpty(value: Record<string, unknown>): boolean {
    return Object.values(value).every((v) => v === undefined);
  }
}
