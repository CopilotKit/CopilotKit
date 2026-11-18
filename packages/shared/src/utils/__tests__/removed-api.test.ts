import { describe, expect, it } from "vitest";
import {
  CopilotKitError,
  CopilotKitErrorCode,
  CopilotKitRemovedApiError,
  removedApiMessage,
} from "../errors";
import { removedApi } from "../removed-api";

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

  it("is a CopilotKitError with the REMOVED_API code", () => {
    expect(error).toBeInstanceOf(CopilotKitError);
    expect(error.name).toBe("CopilotKitRemovedApiError");
    expect(error.code).toBe(CopilotKitErrorCode.REMOVED_API);
    expect(error.extensions.code).toBe(CopilotKitErrorCode.REMOVED_API);
    expect(error.statusCode).toBe(400);
  });

  it("carries the message and links the docs section of the API", () => {
    expect(error.message).toBe(SERVICE_ADAPTER_MESSAGE);
    expect(error.extensions.troubleshootingUrl).toBe(
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
