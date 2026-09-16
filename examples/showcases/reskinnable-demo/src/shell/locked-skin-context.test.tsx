import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  LockedSkinProvider,
  isSkinLockedOut,
  useLockedSkin,
} from "./locked-skin-context";

function Probe() {
  return <span data-testid="locked">{useLockedSkin() ?? "unlocked"}</span>;
}

describe("isSkinLockedOut", () => {
  // THE critical case. Invert this condition and an unlocked deploy 404s every
  // skin — the whole app, from a one-character mistake.
  it("locks out nothing when there is no lock", () => {
    for (const id of ["banking", "airline", "logistics", "keel"]) {
      expect(isSkinLockedOut(id, null)).toBe(false);
    }
  });

  it("lets the locked skin through", () => {
    expect(isSkinLockedOut("banking", "banking")).toBe(false);
  });

  it("locks out every other skin", () => {
    expect(isSkinLockedOut("airline", "banking")).toBe(true);
    expect(isSkinLockedOut("logistics", "banking")).toBe(true);
    expect(isSkinLockedOut("keel", "banking")).toBe(true);
  });

  it("locks out ids that are not skins at all", () => {
    expect(isSkinLockedOut("nope", "banking")).toBe(true);
  });
});

describe("useLockedSkin", () => {
  it("defaults to unlocked with no provider, so existing chrome is unaffected", () => {
    // SelectorCard is rendered bare in its own tests. If the default were
    // anything but null, those tests — and any unprovided subtree — would flip
    // into locked mode.
    render(<Probe />);
    expect(screen.getByTestId("locked").textContent).toBe("unlocked");
  });

  it("exposes the provided id", () => {
    render(
      <LockedSkinProvider lockedSkinId="airline">
        <Probe />
      </LockedSkinProvider>,
    );
    expect(screen.getByTestId("locked").textContent).toBe("airline");
  });

  it("treats an explicit null as unlocked", () => {
    render(
      <LockedSkinProvider lockedSkinId={null}>
        <Probe />
      </LockedSkinProvider>,
    );
    expect(screen.getByTestId("locked").textContent).toBe("unlocked");
  });
});
