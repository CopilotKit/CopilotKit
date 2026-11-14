import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AbstractAgent, Interrupt } from "@ag-ui/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  scanFile,
  shippedSources,
} from "../generative-ui/__tests__/hermes-api-scan";
import {
  installHermesGlobals,
  looksLikeHermes,
} from "../generative-ui/__tests__/hermes-globals";
import { ɵgetAgentInterruptState } from "../interrupt-state";

// Hermes (React Native) has no global structuredClone. useInterrupt, which
// @copilotkit/react-native re-exports, reads the shared interrupt state, so
// that state must be built without one.

describe("interrupt state without a global structuredClone", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = installHermesGlobals();
  });

  afterEach(() => {
    restore();
  });

  it("builds, caches and answers an agent's interrupt batch", () => {
    expect(looksLikeHermes()).toBe(true);
    const interrupts: Interrupt[] = [
      {
        id: "approval",
        reason: "approval",
        metadata: { amount: 12, tags: ["a"] },
      },
    ];
    const agent = {
      threadId: "t1",
      pendingInterrupts: interrupts,
    } as unknown as AbstractAgent;

    const state = ɵgetAgentInterruptState(agent);
    // An equal batch reuses the state, even after the caller's copy changes.
    expect(ɵgetAgentInterruptState(agent)).toBe(state);
    (interrupts[0]!.metadata as { amount: number }).amount = 13;
    expect(ɵgetAgentInterruptState(agent, interrupts)).not.toBe(state);

    const next = ɵgetAgentInterruptState(agent, interrupts);
    expect(next.resolve("allow", "approval", [])).toEqual({
      kind: "resume",
      resume: [
        { interruptId: "approval", status: "resolved", payload: "allow" },
      ],
      toolResults: [],
    });
  });
});

// The same source check as the generative UI entry gets (hermes-globals.test.ts),
// for interrupt-state.ts and the core modules it loads. Its cloneValue comes
// from the @copilotkit/shared root; clone-value.ts is scanned there.
const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "..");
const interruptSources = shippedSources([resolve(SRC, "interrupt-state.ts")]);

describe("the interrupt state sources use no API that Hermes lacks", () => {
  it("scans interrupt-state.ts", () => {
    expect(interruptSources.files.map((file) => relative(SRC, file))).toContain(
      "interrupt-state.ts",
    );
  });

  it.each(interruptSources.files.map((file) => [relative(SRC, file), file]))(
    "%s",
    (name, file) => {
      expect(scanFile(file, name)).toEqual([]);
    },
  );
});

describe("the core root entry", () => {
  it("does not load the generative UI barrel of @copilotkit/shared", () => {
    // Metro does not tree-shake, and the shared UMD has no global for the
    // subpath, so the root takes cloneValue from the @copilotkit/shared root.
    const root = shippedSources([resolve(SRC, "index.ts")]);
    expect(root.files.map((file) => relative(SRC, file))).toContain(
      "interrupt-state.ts",
    );
    expect(root.external).toContain("@copilotkit/shared");
    expect(root.external).not.toContain("@copilotkit/shared/generative-ui");
  });
});
