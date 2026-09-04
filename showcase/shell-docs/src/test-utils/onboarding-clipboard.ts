/**
 * Clipboard stubs and the run-id shape shared by the onboarding prompt
 * button's own test file and its hero-surface counterpart. Both files render
 * `<OnboardingPromptButton>` and exercise its clipboard write, so they need
 * the same three clipboard behaviours (resolves, stays pending, rejects) and
 * agree on the same run-id pattern the CLI validates.
 *
 * Not a `*.test.ts` file, so vitest's `include` glob does not collect it.
 */

import { vi } from "vitest";

/** The shape `copilotkit onboard start --run <id>` accepts. */
export const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;

/** Install a resolving clipboard stub and hand back its spy. */
export function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

/**
 * Install a clipboard stub whose write stays pending until the returned
 * `resolveWrite` is called, so a test can act while a copy is in flight.
 */
export function stubPendingClipboard() {
  let resolve: (() => void) | undefined;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolveWrite) => {
        resolve = resolveWrite;
      }),
  );
  Object.assign(navigator, { clipboard: { writeText } });
  return { writeText, resolveWrite: () => resolve?.() };
}

/** Install a clipboard stub whose write always rejects. */
export function stubRejectingClipboard() {
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}
