/** A receipt from the application's ordinary business handler, not a DOM success guess. */
export type BrowserActionOutcome = {
  status: "completed" | "failed" | "uncertain";
  recordId?: string;
  version?: number;
  reason?: string;
};

type Dispatch = {
  started: boolean;
  resolve(outcome: BrowserActionOutcome): void;
};
const dispatches = new WeakMap<Element, Dispatch>();

/** @internal Distinguish the armed requestSubmit event from manual form takeover. */
export function isApprovedBrowserAction(element: Element): boolean {
  return dispatches.has(element);
}

/** @internal Arm exactly one normal app handler for an approved DOM operation. */
export function observeBrowserAction(element: Element) {
  let resolve!: (outcome: BrowserActionOutcome) => void;
  const result = new Promise<BrowserActionOutcome>((settle) => {
    resolve = settle;
  });
  const dispatch = { started: false, resolve };
  if (dispatches.has(element))
    throw new Error("This control already has an active operation");
  const timer = setTimeout(
    () =>
      resolve({
        status: "uncertain",
        reason: "No application completion receipt arrived",
      }),
    15_000,
  );
  return {
    result,
    arm() {
      if (dispatches.has(element))
        throw new Error("This control already has an active operation");
      dispatches.set(element, dispatch);
    },
    get started() {
      return dispatch.started;
    },
    dispose() {
      clearTimeout(timer);
      if (dispatches.get(element) === dispatch) dispatches.delete(element);
    },
  };
}

/**
 * Wrap an existing app write handler. Real user events keep their normal confirmation;
 * a synthetic event is accepted only once during CopilotKit's approved dispatch.
 * Return a server receipt from `work`; use `failed` only for a definitive rejection.
 *
 * @example
 * await performBrowserAction(event.currentTarget, event.nativeEvent, async () => {
 *   const saved = await saveForm();
 *   return { status: "completed", recordId: saved.id, version: saved.version };
 * }, () => window.confirm("Save changes?"));
 */
export async function performBrowserAction(
  element: Element,
  event: Event,
  work: () => Promise<BrowserActionOutcome>,
  confirm?: () => boolean | Promise<boolean>,
): Promise<BrowserActionOutcome | undefined> {
  const dispatch = dispatches.get(element);
  // requestSubmit() creates a trusted SubmitEvent even when invoked by script.
  // The armed, one-use dispatch identifies an Autopilot operation, not isTrusted.
  if (dispatch) {
    if (dispatch.started) return;
    dispatch.started = true;
  } else {
    if (!event.isTrusted) return;
    if (confirm && !(await confirm())) return;
  }
  let outcome: BrowserActionOutcome;
  try {
    outcome = await work();
  } catch {
    outcome = {
      status: "uncertain",
      reason: "Application handler ended without a confirmed outcome",
    };
  }
  dispatch?.resolve(outcome);
  return outcome;
}
