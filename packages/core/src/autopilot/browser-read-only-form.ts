import type { BrowserPageMap } from "./browser-page-map";
import type { AutopilotNavigationAdapter } from "./browser-navigation";

export type BrowserReadOnlyFormResult = {
  status: "arrived" | "uncertain" | "refused";
  path: string;
  title: string;
};

/** Drives a declared GET form through discovered controls and an app-owned router. */
export class BrowserReadOnlyForm {
  constructor(
    private readonly pageMap: BrowserPageMap,
    private readonly adapter: AutopilotNavigationAdapter,
  ) {}

  async submit(input: {
    fieldRef: string;
    value: string;
    submitRef: string;
    signal?: AbortSignal;
  }): Promise<BrowserReadOnlyFormResult> {
    if (input.signal?.aborted)
      return {
        status: "refused",
        path: window.location.pathname,
        title: document.title,
      };
    if (input.value.length > 500) throw new Error("Query is too long");
    const field = this.pageMap.resolve(input.fieldRef);
    const submit = this.pageMap.resolve(input.submitRef);
    if (
      !(field instanceof HTMLInputElement) ||
      !["search", "text"].includes(field.type) ||
      field.disabled ||
      field.readOnly ||
      !(submit instanceof HTMLButtonElement) ||
      submit.type !== "submit" ||
      submit.disabled
    )
      throw new Error("Choose a visible text field and submit button");
    const form = field.closest("form");
    if (
      !(form instanceof HTMLFormElement) ||
      submit.closest("form") !== form ||
      !form.hasAttribute("data-copilot-readonly-form") ||
      form.method.toLowerCase() !== "get"
    )
      throw new Error("Form is not declared read-only");
    const action = new URL(form.action, window.location.href);
    if (
      action.origin !== window.location.origin ||
      !this.adapter.allowedPath(action.pathname)
    )
      throw new Error("Form action is not allowed");
    if (!this.adapter.mayLeave())
      return {
        status: "refused",
        path: window.location.pathname,
        title: document.title,
      };
    const before = window.location.pathname + window.location.search;
    const beforeMain = document.querySelector("main")?.innerHTML;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(field, input.value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    if (
      !form.isConnected ||
      !field.isConnected ||
      this.pageMap.resolve(input.fieldRef) !== field ||
      this.pageMap.resolve(input.submitRef) !== submit ||
      field.value !== input.value ||
      !form.checkValidity()
    )
      throw new Error("Form changed before search");
    const url = new URL(action);
    for (const [name, value] of new FormData(form)) {
      if (typeof value !== "string")
        throw new Error("File fields are not supported");
      url.searchParams.append(name, value);
    }
    const path = url.pathname + url.search;
    if (path.length > 2_048 || !this.adapter.allowedPath(url.pathname))
      throw new Error("Search destination is not allowed");
    if (input.signal?.aborted)
      return {
        status: "refused",
        path: window.location.pathname,
        title: document.title,
      };
    if (path === before)
      return { status: "arrived", path, title: document.title };
    this.adapter.push(path);
    const arrived = await new Promise<boolean>((resolve) => {
      const started = Date.now();
      const check = () => {
        if (input.signal?.aborted) return resolve(false);
        if (
          window.location.pathname + window.location.search === path &&
          document.querySelector("main")?.innerHTML !== beforeMain
        )
          return resolve(true);
        if (Date.now() - started >= 5_000) return resolve(false);
        window.setTimeout(check, 50);
      };
      check();
    });
    return {
      status: arrived ? "arrived" : "uncertain",
      path: window.location.pathname + window.location.search,
      title: document.title,
    };
  }
}
