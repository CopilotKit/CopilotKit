// packages/react-native/src/__tests__/use-attachments-missing-expo.test.ts
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Simulate a bare RN app where the optional expo modules are NOT installed:
// loading them fails the way Metro would. The hoisted counters record
// whether a load was ever attempted.
const expoLoads = vi.hoisted(() => ({ documentPicker: 0, fileSystem: 0 }));

vi.mock("expo-document-picker", () => {
  expoLoads.documentPicker += 1;
  throw new Error("Unable to resolve module 'expo-document-picker'");
});

vi.mock("expo-file-system", () => {
  expoLoads.fileSystem += 1;
  throw new Error("Unable to resolve module 'expo-file-system'");
});

// Mock @copilotkit/shared -- only the utils we use
vi.mock("@copilotkit/shared", () => ({
  getModalityFromMimeType: () => "document",
  formatFileSize: (bytes: number) => `${bytes} B`,
  randomUUID: () => "test-uuid-" + Math.random().toString(36).slice(2, 8),
}));

// Import AFTER mocks -- this import itself fails if expo is pulled in statically
import { useAttachments } from "../hooks/use-attachments";
import type { NativeFileInput } from "../hooks/use-attachments";

const testFile: NativeFileInput = {
  uri: "file:///tmp/report.pdf",
  name: "report.pdf",
  size: 1024,
  mimeType: "application/pdf",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useAttachments without expo modules installed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expoLoads.documentPicker = 0;
    expoLoads.fileSystem = 0;
  });

  it("imports and mounts without ever loading the expo modules", () => {
    const { result } = renderHook(() =>
      useAttachments({ config: { enabled: true } }),
    );

    expect(result.current.enabled).toBe(true);
    expect(result.current.attachments).toEqual([]);
    expect(expoLoads.documentPicker).toBe(0);
    expect(expoLoads.fileSystem).toBe(0);
  });

  it("openPicker fails gracefully when expo-document-picker is missing", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { result } = renderHook(() =>
      useAttachments({ config: { enabled: true } }),
    );

    await act(async () => {
      await expect(result.current.openPicker()).resolves.toBeUndefined();
    });

    expect(expoLoads.documentPicker).toBeGreaterThan(0);
    expect(consoleError).toHaveBeenCalledWith(
      "[CopilotKit] Document picker error:",
      expect.any(Error),
    );
    expect(result.current.attachments).toEqual([]);

    consoleError.mockRestore();
  });

  it("processFiles reports upload-failed when expo-file-system is missing", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const onUploadFailed = vi.fn();
    const { result } = renderHook(() =>
      useAttachments({
        // No onUpload, so the default expo-file-system reader path is used.
        config: { enabled: true, onUploadFailed },
      }),
    );

    await act(async () => {
      await result.current.processFiles([testFile]);
    });

    expect(expoLoads.fileSystem).toBeGreaterThan(0);
    expect(onUploadFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "upload-failed", file: testFile }),
    );
    expect(result.current.attachments).toEqual([]);

    consoleError.mockRestore();
  });

  it("custom onUpload keeps attachments working without any expo module", async () => {
    const { result } = renderHook(() =>
      useAttachments({
        config: {
          enabled: true,
          onUpload: async () => ({
            type: "data" as const,
            value: "Zm9vYmFy",
            mimeType: "application/pdf",
          }),
        },
      }),
    );

    await act(async () => {
      await result.current.processFiles([testFile]);
    });

    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0].status).toBe("ready");
    expect(expoLoads.fileSystem).toBe(0);
    expect(expoLoads.documentPicker).toBe(0);
  });
});
