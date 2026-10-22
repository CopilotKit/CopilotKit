import { act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { OpenGenerativeUIActivityRenderer } from "../OpenGenerativeUIRenderer";

// The websandbox import is held until `releaseImport()`, so the test decides
// exactly when it resolves relative to the unmount.
const { mockCreate, importGate } = vi.hoisted(() => {
  let releaseImport!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseImport = resolve;
  });
  return {
    mockCreate: vi.fn(() => ({
      iframe: document.createElement("iframe"),
      promise: new Promise(() => {}),
      run: vi.fn(),
      destroy: vi.fn(),
    })),
    importGate: { promise: gate, release: () => releaseImport() },
  };
});

vi.mock("@jetbrains/websandbox", async () => {
  await importGate.promise;
  return { default: { create: mockCreate } };
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("OpenGenerativeUIActivityRenderer unmount race", () => {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it("does not create a sandbox when the import resolves after unmount but before effect cleanup", async () => {
    let hide!: () => void;

    // Releases the import from a layout effect in the commit that unmounts the
    // renderer: React has already removed its DOM, but (for a non-sync update)
    // won't run its passive cleanup until a later task, so the import's
    // continuation runs in between.
    function ReleaseImportOnHide({ shown }: { shown: boolean }) {
      useLayoutEffect(() => {
        if (!shown) importGate.release();
      }, [shown]);
      return null;
    }

    function Harness() {
      const [shown, setShown] = useState(true);
      hide = () => setShown(false);
      return (
        <>
          {shown && (
            <OpenGenerativeUIActivityRenderer
              activityType="open-generative-ui"
              content={{
                html: ["<head></head><body><p>Hi</p></body>"],
                htmlComplete: true,
              }}
              message={{} as never}
              agent={{} as never}
            />
          )}
          <ReleaseImportOnHide shown={shown} />
        </>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    // Mount under act so the sandbox effect runs and starts the (held) import.
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => {
      root.render(<Harness />);
    });

    // Unmount with a default-priority update outside act, so React schedules
    // the passive cleanup in a separate task after the commit.
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    hide();
    for (let i = 0; i < 10; i++) await nextTask();

    expect(mockCreate).not.toHaveBeenCalled();

    root.unmount();
    container.remove();
  });
});
