// packages/react-native/src/__tests__/use-attachments.test.ts
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock expo-document-picker
const mockGetDocumentAsync = vi.fn();
vi.mock("expo-document-picker", () => ({
  getDocumentAsync: (...args: any[]) => mockGetDocumentAsync(...args),
}));

// Mock expo-file-system
const mockReadAsStringAsync = vi.fn();
vi.mock("expo-file-system", () => ({
  readAsStringAsync: (...args: any[]) => mockReadAsStringAsync(...args),
  EncodingType: { Base64: "base64" },
}));

// Mock @copilotkit/shared -- only the utils we use
vi.mock("@copilotkit/shared", () => ({
  getModalityFromMimeType: (mimeType: string) => {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("video/")) return "video";
    return "document";
  },
  formatFileSize: (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  },
  randomUUID: () => "test-uuid-" + Math.random().toString(36).slice(2, 8),
}));

// Import AFTER mocks
import { useAttachments } from "../hooks/use-attachments";
import type { NativeFileInput } from "../hooks/use-attachments";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useAttachments (React Native)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial state ──────────────────────────────────────────────────────

  describe("initial state", () => {
    it("returns empty attachments when no config provided", () => {
      const { result } = renderHook(() => useAttachments({}));

      expect(result.current.attachments).toEqual([]);
      expect(result.current.enabled).toBe(false);
    });

    it("returns enabled=true when config.enabled is true", () => {
      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true } }),
      );

      expect(result.current.enabled).toBe(true);
    });

    it("returns enabled=false when config.enabled is false", () => {
      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: false } }),
      );

      expect(result.current.enabled).toBe(false);
    });
  });

  // ── processFiles ──────────────────────────────────────────────────────

  describe("processFiles", () => {
    it("adds attachment with correct modality for an image", async () => {
      mockReadAsStringAsync.mockResolvedValue("base64ImageData");

      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true } }),
      );

      const file: NativeFileInput = {
        uri: "file:///tmp/photo.jpg",
        name: "photo.jpg",
        size: 1024,
        mimeType: "image/jpeg",
      };

      await act(async () => {
        await result.current.processFiles([file]);
      });

      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0]).toMatchObject({
        type: "image",
        filename: "photo.jpg",
        size: 1024,
        status: "ready",
        source: {
          type: "data",
          value: "base64ImageData",
          mimeType: "image/jpeg",
        },
      });
      expect(result.current.attachments[0].id).toBeDefined();
    });

    it("adds attachment with 'document' modality for a PDF", async () => {
      mockReadAsStringAsync.mockResolvedValue("base64PdfData");

      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true } }),
      );

      const file: NativeFileInput = {
        uri: "file:///tmp/doc.pdf",
        name: "doc.pdf",
        size: 2048,
        mimeType: "application/pdf",
      };

      await act(async () => {
        await result.current.processFiles([file]);
      });

      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0].type).toBe("document");
    });

    it("rejects files that exceed maxSize", async () => {
      const onUploadFailed = vi.fn();

      const { result } = renderHook(() =>
        useAttachments({
          config: {
            enabled: true,
            maxSize: 500,
            onUploadFailed,
          },
        }),
      );

      const file: NativeFileInput = {
        uri: "file:///tmp/big.jpg",
        name: "big.jpg",
        size: 1000,
        mimeType: "image/jpeg",
      };

      await act(async () => {
        await result.current.processFiles([file]);
      });

      expect(result.current.attachments).toHaveLength(0);
      expect(onUploadFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "file-too-large",
        }),
      );
    });

    it("rejects files that do not match accept filter", async () => {
      const onUploadFailed = vi.fn();

      const { result } = renderHook(() =>
        useAttachments({
          config: {
            enabled: true,
            accept: "image/*",
            onUploadFailed,
          },
        }),
      );

      const file: NativeFileInput = {
        uri: "file:///tmp/doc.pdf",
        name: "doc.pdf",
        size: 1024,
        mimeType: "application/pdf",
      };

      await act(async () => {
        await result.current.processFiles([file]);
      });

      expect(result.current.attachments).toHaveLength(0);
      expect(onUploadFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "invalid-type",
        }),
      );
    });

    it("handles file read errors gracefully", async () => {
      mockReadAsStringAsync.mockRejectedValue(new Error("Read failed"));
      const onUploadFailed = vi.fn();

      const { result } = renderHook(() =>
        useAttachments({
          config: { enabled: true, onUploadFailed },
        }),
      );

      const file: NativeFileInput = {
        uri: "file:///tmp/bad.jpg",
        name: "bad.jpg",
        size: 100,
        mimeType: "image/jpeg",
      };

      await act(async () => {
        await result.current.processFiles([file]);
      });

      // Placeholder should have been removed after error
      expect(result.current.attachments).toHaveLength(0);
      expect(onUploadFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "upload-failed",
        }),
      );
    });

    it("calls custom onUpload instead of reading file directly", async () => {
      const customUpload = vi.fn().mockResolvedValue({
        type: "url",
        value: "https://cdn.example.com/photo.jpg",
        mimeType: "image/jpeg",
      });

      const { result } = renderHook(() =>
        useAttachments({
          config: { enabled: true, onUpload: customUpload },
        }),
      );

      const file: NativeFileInput = {
        uri: "file:///tmp/photo.jpg",
        name: "photo.jpg",
        size: 1024,
        mimeType: "image/jpeg",
      };

      await act(async () => {
        await result.current.processFiles([file]);
      });

      expect(customUpload).toHaveBeenCalledWith(file);
      expect(mockReadAsStringAsync).not.toHaveBeenCalled();
      expect(result.current.attachments[0].source).toEqual({
        type: "url",
        value: "https://cdn.example.com/photo.jpg",
        mimeType: "image/jpeg",
      });
    });
  });

  // ── removeAttachment ──────────────────────────────────────────────────

  describe("removeAttachment", () => {
    it("removes an attachment by id", async () => {
      mockReadAsStringAsync.mockResolvedValue("base64Data");

      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true } }),
      );

      const file: NativeFileInput = {
        uri: "file:///tmp/a.jpg",
        name: "a.jpg",
        size: 100,
        mimeType: "image/jpeg",
      };

      await act(async () => {
        await result.current.processFiles([file]);
      });

      const id = result.current.attachments[0].id;

      act(() => {
        result.current.removeAttachment(id);
      });

      expect(result.current.attachments).toHaveLength(0);
    });
  });

  // ── consumeAttachments ────────────────────────────────────────────────

  describe("consumeAttachments", () => {
    it("returns ready attachments and clears the queue", async () => {
      mockReadAsStringAsync.mockResolvedValue("base64Data");

      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true } }),
      );

      const file: NativeFileInput = {
        uri: "file:///tmp/a.jpg",
        name: "a.jpg",
        size: 100,
        mimeType: "image/jpeg",
      };

      await act(async () => {
        await result.current.processFiles([file]);
      });

      expect(result.current.attachments).toHaveLength(1);

      let consumed: any[];
      act(() => {
        consumed = result.current.consumeAttachments();
      });

      expect(consumed!).toHaveLength(1);
      expect(consumed![0].status).toBe("ready");
      expect(result.current.attachments).toHaveLength(0);
    });

    it("returns empty array when no attachments", () => {
      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true } }),
      );

      let consumed: any[];
      act(() => {
        consumed = result.current.consumeAttachments();
      });

      expect(consumed!).toHaveLength(0);
    });
  });

  // ── openPicker ────────────────────────────────────────────────────────

  describe("openPicker", () => {
    it("calls DocumentPicker.getDocumentAsync and processes the result", async () => {
      mockGetDocumentAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: "file:///cache/picked.jpg",
            name: "picked.jpg",
            size: 2048,
            mimeType: "image/jpeg",
          },
        ],
      });
      mockReadAsStringAsync.mockResolvedValue("pickedBase64");

      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true } }),
      );

      await act(async () => {
        await result.current.openPicker();
      });

      expect(mockGetDocumentAsync).toHaveBeenCalledWith({
        type: ["*/*"],
        copyToCacheDirectory: true,
        multiple: true,
      });
      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0].filename).toBe("picked.jpg");
    });

    it("does nothing when picker is canceled", async () => {
      mockGetDocumentAsync.mockResolvedValue({
        canceled: true,
        assets: [],
      });

      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true } }),
      );

      await act(async () => {
        await result.current.openPicker();
      });

      expect(result.current.attachments).toHaveLength(0);
    });

    it("passes accept filter to DocumentPicker", async () => {
      mockGetDocumentAsync.mockResolvedValue({
        canceled: true,
        assets: [],
      });

      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true, accept: "image/*" } }),
      );

      await act(async () => {
        await result.current.openPicker();
      });

      expect(mockGetDocumentAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ["image/*"],
        }),
      );
    });
  });
});
