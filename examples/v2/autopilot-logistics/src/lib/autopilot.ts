import type { BrowserAutopilotAdapter } from "@copilotkit/react-core/v2";
import type { SessionUser } from "./db";

/** App policy only: CopilotKit installs the tools and owns all operation state. */
export function createAutopilotAdapter(
  user: SessionUser,
  router: { push(path: string): void },
): BrowserAutopilotAdapter {
  return {
    identity: { userId: user.id, organizationId: user.organizationId },
    canWrite: async () => {
      const response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) return false;
      const current = await response.json();
      return (
        current.userId === user.id &&
        current.organizationId === user.organizationId &&
        current.role !== "viewer"
      );
    },
    navigation: {
      push: (path) => router.push(path),
      allowedPath: (path) =>
        ["/", "/orders", "/orders/new", "/users"].includes(path) ||
        /^\/orders\/[a-zA-Z0-9_-]+$/.test(path),
      mayLeave: () =>
        !hasUnsavedChanges() || window.confirm("Discard unsaved changes?"),
    },
  };
}

function hasUnsavedChanges(): boolean {
  return [
    ...document.querySelectorAll<HTMLFormElement>(
      "form[data-autopilot-record-id], form[data-autopilot-draft-id]",
    ),
  ].some(
    (form) =>
      [...form.elements].some((element) => {
        if (element instanceof HTMLInputElement)
          return ["checkbox", "radio"].includes(element.type)
            ? element.checked !== element.defaultChecked
            : element.value !== element.defaultValue;
        if (element instanceof HTMLTextAreaElement)
          return element.value !== element.defaultValue;
        if (element instanceof HTMLSelectElement)
          return [...element.options].some(
            (option) => option.selected !== option.defaultSelected,
          );
        return false;
      }) ||
      [...form.querySelectorAll("[data-autopilot-custom-select]")].some(
        (element) =>
          element.getAttribute("data-autopilot-selected") !==
          element.getAttribute("data-copilot-initial-value"),
      ),
  );
}
