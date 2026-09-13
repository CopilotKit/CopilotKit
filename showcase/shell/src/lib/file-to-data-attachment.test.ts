import { afterEach, describe, expect, it, vi } from "vitest";
import { fileToDataAttachment } from "../../../shared/react/demos/multimodal/file-to-data-attachment";

describe("fileToDataAttachment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses FileReader data URLs to preserve bytes, MIME type, name, and size", async () => {
    const file = new File([new Uint8Array([0, 1, 2, 255])], "receipt.pdf", {
      type: "application/pdf",
    });

    await expect(fileToDataAttachment(file)).resolves.toEqual({
      type: "data",
      value: "AAEC/w==",
      mimeType: "application/pdf",
      metadata: {
        filename: "receipt.pdf",
        size: 4,
      },
    });
  });

  it("keeps an empty file valid and supplies the runtime-safe fallback MIME type", async () => {
    const file = new File([], "recording", { type: "" });

    await expect(fileToDataAttachment(file)).resolves.toEqual({
      type: "data",
      value: "",
      mimeType: "application/octet-stream",
      metadata: {
        filename: "recording",
        size: 0,
      },
    });
  });

  it("rejects when the browser FileReader cannot read the selected file", async () => {
    class FailingFileReader {
      error = new DOMException("read failed", "NotReadableError");
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      result: string | ArrayBuffer | null = null;

      readAsDataURL(_file: Blob) {
        this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>);
      }
    }

    vi.stubGlobal("FileReader", FailingFileReader);

    await expect(
      fileToDataAttachment(
        new File(["broken"], "broken.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toThrow("read failed");
  });
});
