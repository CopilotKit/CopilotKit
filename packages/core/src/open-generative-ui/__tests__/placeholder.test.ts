import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { PlaceholderCycler } from "../placeholder";

describe("PlaceholderCycler", () => {
  let cycler: PlaceholderCycler;

  beforeEach(() => {
    vi.useFakeTimers();
    cycler = new PlaceholderCycler();
  });
  afterEach(() => {
    cycler.dispose();
    vi.useRealTimers();
  });

  const message = () => cycler.getSnapshot().message;

  it("shows a newly streamed message at once", () => {
    cycler.update(["One"], false);
    expect(message()).toBe("One");
    cycler.update(["One", "Two"], false);
    expect(message()).toBe("Two");
  });

  it("rotates every 5 seconds while the call runs", () => {
    cycler.update(["One", "Two"], false);
    vi.advanceTimersByTime(5000);
    expect(message()).toBe("One");
    vi.advanceTimersByTime(5000);
    expect(message()).toBe("Two");
  });

  it("does not restart the rotation for a snapshot with the same messages", () => {
    cycler.update(["One", "Two"], false);
    vi.advanceTimersByTime(4000);
    cycler.update(["One", "Two"], false);
    vi.advanceTimersByTime(1000);
    expect(message()).toBe("One");
  });

  it("shows nothing once the call is complete", () => {
    cycler.update(["One"], false);
    cycler.update(["One"], true);
    expect(message()).toBeUndefined();
  });

  it("shows nothing without messages", () => {
    cycler.update(undefined, false);
    expect(message()).toBeUndefined();
  });
});
