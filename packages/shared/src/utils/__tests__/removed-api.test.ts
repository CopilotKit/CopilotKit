import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CopilotKitError,
  CopilotKitErrorCode,
  CopilotKitRemovedApiError,
  ERROR_NAMES,
  isStructuredCopilotKitError,
  removedApiMessage,
} from "../errors";
import {
  checkRemovedOptions,
  removedApi,
  warnRemovedApiOnce,
} from "../removed-api";
import type { RemovedOption } from "../removed-api";

const SERVICE_ADAPTER_MESSAGE =
  'The "serviceAdapter" option of CopilotKitRuntime was removed in CopilotKit 2.0. Pass a model to a BuiltInAgent. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime';

const USE_COPILOT_ACTION_MESSAGE =
  '"useCopilotAction" was removed in CopilotKit 2.0. Use useFrontendTool from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping';

/** Runs `run` and returns what it threw. */
function thrownBy(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

/** The stand-in as a function, as plain JavaScript code sees it. */
function asFunction(stub: unknown) {
  if (typeof stub !== "function") throw new Error("not a function");
  return stub;
}

describe("removedApiMessage", () => {
  it("names the removed API, the replacement, the codemod, and the docs section", () => {
    const message = removedApiMessage({
      what: '"useCopilotAction"',
      use: "Use useFrontendTool from @copilotkit/react-core.",
      docs: "/migrate/v2#hook-mapping",
    });

    expect(message).toBe(USE_COPILOT_ACTION_MESSAGE);
  });
});

describe("CopilotKitRemovedApiError", () => {
  const error = new CopilotKitRemovedApiError({
    what: 'The "serviceAdapter" option of CopilotKitRuntime',
    use: "Pass a model to a BuiltInAgent.",
    docs: "/migrate/v2#update-the-runtime",
  });

  it("is an Error with the REMOVED_API code", () => {
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(ERROR_NAMES.REMOVED_API_ERROR);
    expect(error.code).toBe(CopilotKitErrorCode.REMOVED_API);
  });

  // It is not a CopilotKitError, so that it does not add the error table to
  // each app bundle. The name keeps it a structured CopilotKit error.
  it("is not a CopilotKitError, but counts as a structured CopilotKit error", () => {
    expect(error).not.toBeInstanceOf(CopilotKitError);
    expect(isStructuredCopilotKitError(error)).toBe(true);
  });

  it("carries the message and links the docs section of the API", () => {
    expect(error.message).toBe(SERVICE_ADAPTER_MESSAGE);
    expect(error.docsUrl).toBe(
      "https://docs.copilotkit.ai/migrate/v2#update-the-runtime",
    );
  });
});

describe("removedApi", () => {
  // Creating the stand-in is what importing it does, so it must not throw.
  const stub = asFunction(
    removedApi({
      name: "useCopilotAction",
      use: "Use useFrontendTool from @copilotkit/react-core.",
      docs: "/migrate/v2#hook-mapping",
    }),
  );

  it("throws the removal error when code calls it", () => {
    const error = thrownBy(() => stub({ name: "sayHello" }));

    expect(error).toBeInstanceOf(CopilotKitRemovedApiError);
    expect(error).toHaveProperty("message", USE_COPILOT_ACTION_MESSAGE);
  });

  it("throws the removal error when code constructs it", () => {
    const error = thrownBy(() => Reflect.construct(stub, []));

    expect(error).toBeInstanceOf(CopilotKitRemovedApiError);
    expect(error).toHaveProperty("message", USE_COPILOT_ACTION_MESSAGE);
  });

  it("has the name of the removed export", () => {
    expect(stub.name).toBe("useCopilotAction");
  });
});

describe("checkRemovedOptions", () => {
  // Each test uses its own names: a warning is written once per process.
  const removed: Record<string, RemovedOption> = {
    threadId: {
      effect: "throw",
      use: "Pass threadId to CopilotChat.",
      docs: "/migrate/removed-apis-2.0#provider-props",
    },
    textToSpeechUrl: {
      effect: "warn",
      use: "Voice goes through the runtime.",
      docs: "/migrate/removed-apis-2.0#provider-props",
    },
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws the removal error for an option that cannot work", () => {
    const error = thrownBy(() =>
      checkRemovedOptions("prop of CopilotKit", { threadId: "t1" }, removed),
    );

    expect(error).toBeInstanceOf(CopilotKitRemovedApiError);
    expect(error).toHaveProperty(
      "message",
      'The "threadId" prop of CopilotKit was removed in CopilotKit 2.0. Pass threadId to CopilotChat. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#provider-props',
    );
  });

  it("warns once, in development, for an option that 2.0 ignores", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const options = { textToSpeechUrl: "/api/tts" };

    checkRemovedOptions("prop of CopilotKit", options, removed);
    checkRemovedOptions("prop of CopilotKit", options, removed);

    expect(warn.mock.calls).toEqual([
      [
        'The "textToSpeechUrl" prop of CopilotKit was removed in CopilotKit 2.0. Voice goes through the runtime. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#provider-props',
      ],
    ]);
  });

  it("does nothing for options that are not set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    checkRemovedOptions(
      "prop of CopilotKit",
      { runtimeUrl: "/api/copilotkit", threadId: undefined },
      removed,
    );

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("warnRemovedApiOnce", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stays quiet in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    warnRemovedApiOnce({
      what: 'The "observability_c" option of CopilotKitRuntime',
      use: "Delete it.",
      docs: "/migrate/removed-apis-2.0#runtime-options",
    });

    expect(warn).not.toHaveBeenCalled();
  });
});
