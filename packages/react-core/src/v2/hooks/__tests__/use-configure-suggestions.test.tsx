import React, { Suspense, startTransition, useState } from "react";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "@copilotkit/core";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";
import { useConfigureSuggestions } from "../use-configure-suggestions";

const never = new Promise<never>(() => {});

type HarnessProps = { instructions: string; suspend: boolean };
let setHarnessProps: (next: HarnessProps) => void = () => {};

function Configure({ instructions, suspend }: HarnessProps) {
  // A fresh config object on every render, as an inline literal would be.
  useConfigureSuggestions({ instructions, available: "always" });
  if (suspend) throw never;
  return null;
}

function Harness() {
  const [props, setProps] = useState<HarnessProps>({
    instructions: "first",
    suspend: false,
  });
  setHarnessProps = setProps;
  return (
    <Suspense fallback={null}>
      <Configure {...props} />
    </Suspense>
  );
}

describe("useConfigureSuggestions config identity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers once while an inline config keeps the same content", () => {
    const addSpy = vi.spyOn(CopilotKitCore.prototype, "addSuggestionsConfig");
    renderWithCopilotKit({ children: <Harness /> });
    expect(addSpy).toHaveBeenCalledTimes(1);

    act(() => setHarnessProps({ instructions: "first", suspend: false }));
    act(() => setHarnessProps({ instructions: "first", suspend: false }));
    expect(addSpy).toHaveBeenCalledTimes(1);

    act(() => setHarnessProps({ instructions: "second", suspend: false }));
    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(addSpy.mock.calls[1]?.[0]).toMatchObject({
      instructions: "second",
    });
  });

  it("does not re-register after a render that React discards", async () => {
    const addSpy = vi.spyOn(CopilotKitCore.prototype, "addSuggestionsConfig");
    renderWithCopilotKit({ children: <Harness /> });
    expect(addSpy).toHaveBeenCalledTimes(1);

    // A transition that suspends is never committed, so its config must not
    // become the cached one.
    await act(async () => {
      startTransition(() => {
        setHarnessProps({ instructions: "discarded", suspend: true });
      });
    });

    // An urgent update back on the committed content keeps the committed
    // config object, so nothing re-registers.
    act(() => setHarnessProps({ instructions: "first", suspend: false }));
    expect(addSpy).toHaveBeenCalledTimes(1);
  });
});
