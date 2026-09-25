import type { BrowserPageMap } from "./browser-page-map";

export interface AutopilotFieldChange {
  ref: string;
  value: string;
}

type Fillable = Element;

function customSelect(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.hasAttribute("data-autopilot-custom-select")
  );
}

function formValue(element: Element): string {
  if (
    element instanceof HTMLInputElement &&
    ["checkbox", "radio"].includes(element.type)
  )
    return JSON.stringify([element.value, element.checked]);
  if (element instanceof HTMLSelectElement && element.multiple)
    return JSON.stringify(
      [...element.selectedOptions].map((option) => option.value),
    );
  return fieldValue(element);
}

function submissionState(element: Element): string {
  const field = element as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement;
  return JSON.stringify({
    value: formValue(element),
    name: field.name,
    type: field.type,
    disabled: field.disabled,
    readOnly: "readOnly" in field ? field.readOnly : false,
  });
}
function formFields(form: HTMLFormElement): Element[] {
  return [...form.elements].filter(
    (element) =>
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement,
  );
}
function matchesBaseline(
  form: HTMLFormElement,
  baseline: Map<Element, string>,
): boolean {
  const fields = formFields(form);
  return (
    fields.length === baseline.size &&
    fields.every(
      (element) => baseline.get(element) === submissionState(element),
    )
  );
}
function advanceValue(baseline: Map<Element, string>, element: Element): void {
  const previous = baseline.get(element);
  if (!previous) return;
  // Only this operation's value change is expected; name/disabled/type changes are not.
  const state = JSON.parse(previous);
  state.value = formValue(element);
  baseline.set(element, JSON.stringify(state));
}

function interactable(element: Element): boolean {
  return !element.matches(":disabled, [readonly], [aria-disabled='true']");
}

function fieldValue(element: Fillable): string {
  return customSelect(element)
    ? (element.getAttribute("data-autopilot-selected") ?? "")
    : (element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)
        .value;
}

type PreparedField = {
  ref: string;
  element: Fillable;
  label: string;
  before: string;
  after: string;
};

export interface AutopilotFormPlan {
  form: HTMLFormElement;
  submit: HTMLButtonElement;
  submitRef: string;
  fields: PreparedField[];
  baseline: Map<Element, string>;
  path: string;
  identity: string;
  recordId: string;
  version: number;
  action: "create_form" | "edit_form";
  review: {
    form: string;
    submit: string;
    fields: Array<{ label: string; before: string; after: string }>;
  };
}

export type AutopilotFormDispatch =
  | { status: "dispatched"; applied: number }
  | { status: "failed" | "partial"; applied: number; reason: string };

/** Bounded native form driver. The app supplies identity, approval, and a completion receipt. */
export class BrowserFormBatch {
  constructor(private readonly pageMap: BrowserPageMap) {}

  prepare(
    changes: AutopilotFieldChange[],
    submitRef: string,
  ): AutopilotFormPlan {
    if (!changes.length || changes.length > 12)
      throw new Error("Choose between 1 and 12 fields");
    if (new Set(changes.map((change) => change.ref)).size !== changes.length)
      throw new Error("A field was listed twice");
    if (
      changes.reduce((total, change) => total + change.value.length, 0) > 5_000
    )
      throw new Error("Form values exceed the request limit");
    const submit = this.pageMap.resolve(submitRef);
    if (
      !(submit instanceof HTMLButtonElement) ||
      submit.type !== "submit" ||
      submit.disabled
    )
      throw new Error("Select a visible submit button");
    const form = submit.closest("form");
    if (!(form instanceof HTMLFormElement))
      throw new Error("Submit button is not in a form");
    const recordId = form.getAttribute("data-autopilot-record-id") ?? "";
    const draftId = form.getAttribute("data-autopilot-draft-id") ?? "";
    const version = recordId
      ? Number(form.getAttribute("data-autopilot-record-version"))
      : 0;
    if (
      (!recordId && !draftId) ||
      (recordId && (!Number.isInteger(version) || version < 1))
    )
      throw new Error("Form has no stable target identity");
    const controls = new Map(
      this.pageMap.read().controls.map((control) => [control.ref, control]),
    );
    const fields: PreparedField[] = changes.map(({ ref, value }) => {
      if (value.length > 2_000) throw new Error("A field value is too long");
      const element = this.pageMap.resolve(ref);
      if (
        !(
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement ||
          customSelect(element)
        ) ||
        element.closest("form") !== form
      )
        throw new Error("Field is not in the selected form");
      const readOnly =
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
          ? element.readOnly
          : false;
      if (
        (element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? element.disabled
          : element.getAttribute("aria-disabled") === "true") ||
        readOnly ||
        (element instanceof HTMLInputElement &&
          !["text", "date", "email", "number", "tel", "url", "search"].includes(
            element.type,
          ))
      )
        throw new Error("Field type is not supported for automatic fill");
      if (
        element instanceof HTMLSelectElement &&
        ![...element.options].some((option) => option.value === value)
      )
        throw new Error("Choose one of the select's available options");
      if (
        customSelect(element) &&
        ![...element.querySelectorAll("[data-autopilot-option]")].some(
          (option) => option.getAttribute("data-autopilot-option") === value,
        )
      )
        throw new Error("Choose one of the custom select's available options");
      const label =
        controls.get(ref)?.name || element.getAttribute("name") || ref;
      return { ref, element, label, before: fieldValue(element), after: value };
    });
    const identity = JSON.stringify({
      recordId,
      draftId,
      version,
      handlerVersion: form.getAttribute("data-autopilot-handler-version"),
      form: form.getAttribute("aria-label"),
      path: window.location.pathname,
    });
    return {
      form,
      submit,
      submitRef,
      fields,
      baseline: new Map(
        formFields(form).map((element) => [element, submissionState(element)]),
      ),
      path: window.location.pathname,
      identity,
      recordId: recordId || draftId,
      version,
      action: recordId ? "edit_form" : "create_form",
      review: {
        form: form.getAttribute("aria-label") ?? "Form",
        submit: submit.textContent?.trim() ?? "Submit",
        fields: fields.map(({ label, before, after }) => ({
          label,
          before,
          after,
        })),
      },
    };
  }

  isCurrent(plan: AutopilotFormPlan): boolean {
    try {
      const fresh = this.prepare(
        plan.fields.map((field) => ({ ref: field.ref, value: field.after })),
        plan.submitRef,
      );
      return (
        fresh.identity === plan.identity &&
        fresh.form === plan.form &&
        matchesBaseline(plan.form, plan.baseline)
      );
    } catch {
      return false;
    }
  }

  async dispatch(
    plan: AutopilotFormPlan,
    recheck: () => Promise<boolean>,
    beforeSubmit: () => void = () => {},
  ): Promise<AutopilotFormDispatch> {
    const expected = new Map(
      plan.fields.map((field) => [field.element, field.before]),
    );
    const baseline = new Map(plan.baseline);
    let applied = 0;
    const guard = async (): Promise<boolean> => {
      if (
        !(await recheck()) ||
        !plan.form.isConnected ||
        window.location.pathname !== plan.path
      )
        return false;
      const currentIdentity = JSON.stringify({
        recordId: plan.form.getAttribute("data-autopilot-record-id") ?? "",
        draftId: plan.form.getAttribute("data-autopilot-draft-id") ?? "",
        version: plan.form.hasAttribute("data-autopilot-record-id")
          ? Number(plan.form.getAttribute("data-autopilot-record-version"))
          : 0,
        handlerVersion: plan.form.getAttribute(
          "data-autopilot-handler-version",
        ),
        form: plan.form.getAttribute("aria-label"),
        path: window.location.pathname,
      });
      if (
        currentIdentity !== plan.identity ||
        this.pageMap.resolve(plan.submitRef) !== plan.submit ||
        !interactable(plan.submit) ||
        !matchesBaseline(plan.form, baseline)
      )
        return false;
      return plan.fields.every(
        (field) =>
          this.pageMap.resolve(field.ref) === field.element &&
          interactable(field.element) &&
          fieldValue(field.element) === expected.get(field.element),
      );
    };
    try {
      for (const field of plan.fields) {
        if (!(await guard()))
          return {
            status: applied ? "partial" : "failed",
            applied,
            reason: "Form changed before fill",
          };
        await this.setValue(field.element, field.after);
        if (fieldValue(field.element) !== field.after)
          return {
            status: "partial",
            applied,
            reason: `Browser rejected ${field.label}`,
          };
        expected.set(field.element, field.after);
        if (baseline.has(field.element)) advanceValue(baseline, field.element);
        // A supported custom select writes its own hidden value as part of this fill.
        if (customSelect(field.element)) {
          for (const hidden of field.element.querySelectorAll(
            'input[type="hidden"]',
          )) {
            if (baseline.has(hidden)) advanceValue(baseline, hidden);
          }
        }
        applied++;
      }
      if (!(await guard()))
        return {
          status: "partial",
          applied,
          reason: "Form changed before submit",
        };
      if (!plan.form.checkValidity())
        return {
          status: "partial",
          applied,
          reason: "Form validation rejected the reviewed values",
        };
      beforeSubmit();
      plan.form.requestSubmit(plan.submit);
      return { status: "dispatched", applied };
    } catch (error) {
      return {
        status: applied ? "partial" : "failed",
        applied,
        reason: error instanceof Error ? error.message : "Form action failed",
      };
    }
  }

  private async setValue(element: Fillable, value: string): Promise<void> {
    if (customSelect(element)) {
      const option = [
        ...element.querySelectorAll("[data-autopilot-option]"),
      ].find(
        (candidate) =>
          candidate.getAttribute("data-autopilot-option") === value,
      );
      if (!(option instanceof HTMLButtonElement) || option.disabled)
        throw new Error("Custom select option is no longer available");
      option.click();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      return;
    }
    if (
      !(
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      )
    )
      throw new Error("Field is no longer fillable");
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}
