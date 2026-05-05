import {
  Directive,
  Inject,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from "@angular/core";
import { AbstractAgent } from "@ag-ui/client";
import { CopilotKit } from "../copilotkit";

/**
 * Template-form directive for registering an agent with CopilotKit at runtime.
 *
 * Useful when an agent instance is owned by a component (e.g. constructed
 * from props) and should be made available to descendants via the standard
 * `injectAgent` / `<copilot-chat>` machinery. The directive registers the
 * agent on init, updates it on input changes, and removes it on destroy.
 *
 * @example
 * ```html
 * <!-- Register a single agent under an explicit id -->
 * <div [copilotkitAgent]="agent" agentId="my-agent">
 *   <copilot-chat agentId="my-agent"></copilot-chat>
 * </div>
 *
 * <!-- Register multiple agents at once -->
 * <div [copilotkitAgent]="{ planner: plannerAgent, writer: writerAgent }">
 *   <copilot-chat agentId="writer"></copilot-chat>
 * </div>
 * ```
 */
@Directive({
  selector: "[copilotkitAgent]",
  standalone: true,
})
export class CopilotKitAgentDirective implements OnInit, OnChanges, OnDestroy {
  constructor(@Inject(CopilotKit) private readonly copilotkit: CopilotKit) {}

  /**
   * Either a single agent (paired with `agentId`) or a record of
   * `{ id: agent }` to register multiple agents at once.
   */
  @Input("copilotkitAgent") agent?:
    | AbstractAgent
    | Record<string, AbstractAgent>;

  /**
   * Required when `agent` is a single `AbstractAgent` instance.
   * Ignored when `agent` is a `Record<string, AbstractAgent>`.
   */
  @Input() agentId?: string;

  private registeredIds: string[] = [];

  ngOnInit(): void {
    this.registerAgents();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!("agent" in changes) && !("agentId" in changes)) {
      return;
    }
    if (
      changes["agent"]?.firstChange === true &&
      changes["agentId"]?.firstChange !== false
    ) {
      // ngOnInit will handle the first call.
      return;
    }
    this.unregisterAgents();
    this.registerAgents();
  }

  ngOnDestroy(): void {
    this.unregisterAgents();
  }

  private registerAgents(): void {
    const map = this.resolveAgentMap();
    if (!map) {
      return;
    }
    const existing = this.copilotkit.agents();
    const merged: Record<string, AbstractAgent> = { ...existing, ...map };
    this.copilotkit.updateRuntime({ agents: merged });
    this.registeredIds = Object.keys(map);
  }

  private unregisterAgents(): void {
    if (this.registeredIds.length === 0) {
      return;
    }
    const remaining = { ...this.copilotkit.agents() };
    for (const id of this.registeredIds) {
      delete remaining[id];
    }
    this.copilotkit.updateRuntime({ agents: remaining });
    this.registeredIds = [];
  }

  private resolveAgentMap(): Record<string, AbstractAgent> | null {
    if (!this.agent) {
      return null;
    }
    if (this.isAgentMap(this.agent)) {
      return this.agent;
    }
    if (!this.agentId) {
      return null;
    }
    return { [this.agentId]: this.agent };
  }

  private isAgentMap(
    value: AbstractAgent | Record<string, AbstractAgent>,
  ): value is Record<string, AbstractAgent> {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    return typeof (value as { subscribe?: unknown }).subscribe !== "function";
  }
}
