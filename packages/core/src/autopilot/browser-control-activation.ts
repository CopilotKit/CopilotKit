import type { BrowserPageMap } from "./browser-page-map";

export interface BrowserControlActivationPlan {
  ref: string;
  element: HTMLButtonElement;
  container: Element;
  recordId: string;
  version: number;
  action: string;
  handlerVersion: string;
  path: string;
}

/** Activates an app-owned, discovered button without knowing its business meaning. */
export class BrowserControlActivator {
  constructor(private readonly pageMap: BrowserPageMap) {}

  prepare(ref: string): BrowserControlActivationPlan {
    const element = this.pageMap.resolve(ref);
    if (!(element instanceof HTMLButtonElement) || element.disabled)
      throw new Error("Select an available button");
    const action = element.getAttribute("data-copilot-action") ?? "";
    const handlerVersion =
      element.getAttribute("data-autopilot-handler-version") ?? "";
    const container = element.closest("[data-autopilot-record-id]");
    const recordId = container?.getAttribute("data-autopilot-record-id") ?? "";
    const version = Number(
      container?.getAttribute("data-autopilot-record-version"),
    );
    if (
      !action ||
      !handlerVersion ||
      !container ||
      !recordId ||
      !Number.isInteger(version) ||
      version < 1
    )
      throw new Error("Button has no stable action identity");
    return {
      ref,
      element,
      container,
      recordId,
      version,
      action,
      handlerVersion,
      path: window.location.pathname,
    };
  }

  isCurrent(plan: BrowserControlActivationPlan): boolean {
    try {
      return (
        this.pageMap.resolve(plan.ref) === plan.element &&
        plan.element.isConnected &&
        !plan.element.disabled &&
        plan.element.closest("[data-autopilot-record-id]") === plan.container &&
        plan.container.getAttribute("data-autopilot-record-id") ===
          plan.recordId &&
        Number(plan.container.getAttribute("data-autopilot-record-version")) ===
          plan.version &&
        plan.element.getAttribute("data-copilot-action") === plan.action &&
        plan.element.getAttribute("data-autopilot-handler-version") ===
          plan.handlerVersion &&
        window.location.pathname === plan.path
      );
    } catch {
      return false;
    }
  }

  activate(plan: BrowserControlActivationPlan): void {
    if (!this.isCurrent(plan))
      throw new Error("Control changed before activation");
    plan.element.click();
  }
}
