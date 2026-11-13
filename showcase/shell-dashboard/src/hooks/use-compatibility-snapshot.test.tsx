import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPATIBILITY_SNAPSHOT } from "@/lib/compatibility";
import { useCompatibilitySnapshot } from "./use-compatibility-snapshot";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const saved = {
  ...COMPATIBILITY_SNAPSHOT,
  date: "October 13, 2026",
  assessedAt: "2026-10-13T12:00:00Z",
};
describe("saved Compatibility data", () => {
  it("loads saved results without invoking an audit", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({ snapshot: saved, lastAttemptStatus: "success" }),
    );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useCompatibilitySnapshot);
    await waitFor(() => expect(result.current.saved).toBe(true));
    expect(result.current.snapshot.date).toBe(saved.date);
    expect(fetch.mock.calls[0][0]).toBe("/api/ops/compatibility");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retains the successful snapshot when the next read fails", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ snapshot: saved, lastAttemptStatus: "success" }),
      )
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useCompatibilitySnapshot);
    await waitFor(() => expect(result.current.saved).toBe(true));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.snapshot.assessedAt).toBe(saved.assessedAt);
    expect(result.current.readError).toBe(true);
  });
  it("exposes failed attempts while retaining the successful assessment timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL) =>
        Response.json({
          snapshot: saved,
          lastAttemptStatus: "failed",
          runUrl: "https://github.com/CopilotKit/CopilotKit/actions/runs/123",
        }),
      ),
    );
    const { result } = renderHook(useCompatibilitySnapshot);
    await waitFor(() => expect(result.current.saved).toBe(true));
    expect(result.current.lastAttemptStatus).toBe("failed");
    expect(result.current.snapshot.assessedAt).toBe(saved.assessedAt);
  });
});
