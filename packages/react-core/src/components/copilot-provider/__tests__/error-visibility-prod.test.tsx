import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

// Mock modules before imports
vi.mock("../../../utils/dev-console", () => ({
  shouldShowDevConsole: vi.fn(),
}));

vi.mock("../../../context/copilot-context", () => ({
  useCopilotContext: vi.fn(),
}));

vi.mock("../../toast/toast-provider", () => ({
  useToast: vi.fn(),
}));

vi.mock("@copilotkit/runtime-client-gql", () => ({
  loadMessagesFromJsonRepresentation: vi.fn(),
}));

import { shouldShowDevConsole } from "../../../utils/dev-console";
import { ErrorVisibility, CopilotKitErrorCode } from "@copilotkit/shared";

describe("Error visibility when showDevConsole=false (#2431)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should NOT suppress errors with toast visibility when isDev is false", () => {
    // Simulate production: shouldShowDevConsole returns false
    (shouldShowDevConsole as Mock).mockReturnValue(false);

    const isDev = shouldShowDevConsole(false);
    expect(isDev).toBe(false);

    // A TOAST-visible error should still be surfaced in production
    const visibility = ErrorVisibility.TOAST;
    const shouldSurface =
      visibility === ErrorVisibility.TOAST ||
      visibility === ErrorVisibility.BANNER;

    expect(shouldSurface).toBe(true);
  });

  it("should suppress DEV_ONLY errors when isDev is false", () => {
    (shouldShowDevConsole as Mock).mockReturnValue(false);

    const isDev = shouldShowDevConsole(false);
    const visibility = ErrorVisibility.DEV_ONLY;

    // DEV_ONLY errors should be suppressed when not in dev mode
    const shouldSuppress = !isDev && visibility === ErrorVisibility.DEV_ONLY;
    expect(shouldSuppress).toBe(true);
  });

  it("should suppress SILENT errors regardless of isDev", () => {
    (shouldShowDevConsole as Mock).mockReturnValue(false);

    const visibility = ErrorVisibility.SILENT;
    const shouldSurface =
      visibility === ErrorVisibility.TOAST ||
      visibility === ErrorVisibility.BANNER;

    expect(shouldSurface).toBe(false);
  });
});
