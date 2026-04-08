import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../../__tests__/utils/test-helpers";
import { CopilotChat } from "../CopilotChat";
import type { AttachmentUploadError } from "@copilotkit/shared";
import { type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { Observable, EMPTY } from "rxjs";

class NoopAgent extends MockStepwiseAgent {
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }
  connect(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }
}

function createFile(name: string, size: number, type: string): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

function renderChat(props: {
  onUploadFailed?: (error: AttachmentUploadError) => void;
  accept?: string;
  maxSize?: number;
  onUpload?: (file: File) => any;
}) {
  const agent = new NoopAgent();
  return renderWithCopilotKit({
    agent,
    children: (
      <CopilotChat
        welcomeScreen={false}
        attachments={{
          enabled: true,
          accept: props.accept,
          maxSize: props.maxSize,
          onUploadFailed: props.onUploadFailed,
          onUpload: props.onUpload,
        }}
      />
    ),
  });
}

async function dropFiles(container: HTMLElement, files: File[]) {
  const dropTarget = container.querySelector('[data-testid="copilot-chat"]');
  if (!dropTarget) {
    throw new Error("Could not find copilot-chat drop target");
  }

  fireEvent.dragOver(dropTarget, {
    dataTransfer: { files, types: ["Files"] },
  });
  fireEvent.drop(dropTarget, {
    dataTransfer: { files, types: ["Files"] },
  });
}

describe("CopilotChat attachments", () => {
  describe("onUploadFailed", () => {
    it("fires with 'invalid-type' when file does not match accept filter", async () => {
      const onUploadFailed = vi.fn();
      const { container } = renderChat({
        accept: "image/*",
        onUploadFailed,
      });

      const pdfFile = createFile("document.pdf", 1024, "application/pdf");
      await dropFiles(container, [pdfFile]);

      await waitFor(() => {
        expect(onUploadFailed).toHaveBeenCalledTimes(1);
      });

      const error: AttachmentUploadError = onUploadFailed.mock.calls[0][0];
      expect(error.reason).toBe("invalid-type");
      expect(error.file).toBe(pdfFile);
      expect(error.message).toContain("document.pdf");
    });

    it("fires with 'file-too-large' when file exceeds maxSize", async () => {
      const onUploadFailed = vi.fn();
      const { container } = renderChat({
        maxSize: 100,
        onUploadFailed,
      });

      const largeFile = createFile("big.png", 200, "image/png");
      await dropFiles(container, [largeFile]);

      await waitFor(() => {
        expect(onUploadFailed).toHaveBeenCalledTimes(1);
      });

      const error: AttachmentUploadError = onUploadFailed.mock.calls[0][0];
      expect(error.reason).toBe("file-too-large");
      expect(error.file).toBe(largeFile);
      expect(error.message).toContain("big.png");
    });

    it("fires with 'upload-failed' when onUpload throws", async () => {
      const onUploadFailed = vi.fn();
      const { container } = renderChat({
        onUpload: () => {
          throw new Error("S3 upload failed");
        },
        onUploadFailed,
      });

      const file = createFile("photo.png", 50, "image/png");
      await dropFiles(container, [file]);

      await waitFor(() => {
        expect(onUploadFailed).toHaveBeenCalledTimes(1);
      });

      const error: AttachmentUploadError = onUploadFailed.mock.calls[0][0];
      expect(error.reason).toBe("upload-failed");
      expect(error.file).toBe(file);
      expect(error.message).toBe("S3 upload failed");
    });

    it("fires multiple times for multiple rejected files", async () => {
      const onUploadFailed = vi.fn();
      const { container } = renderChat({
        accept: "image/*",
        onUploadFailed,
      });

      const pdf = createFile("a.pdf", 100, "application/pdf");
      const doc = createFile(
        "b.docx",
        100,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      await dropFiles(container, [pdf, doc]);

      await waitFor(() => {
        expect(onUploadFailed).toHaveBeenCalledTimes(2);
      });

      expect(onUploadFailed.mock.calls[0][0].reason).toBe("invalid-type");
      expect(onUploadFailed.mock.calls[1][0].reason).toBe("invalid-type");
    });

    it("does not fire for valid files", async () => {
      const onUploadFailed = vi.fn();
      const { container } = renderChat({
        accept: "image/*",
        maxSize: 10000,
        onUploadFailed,
      });

      const validFile = createFile("photo.png", 500, "image/png");
      await dropFiles(container, [validFile]);

      // Give time for any async processing
      await new Promise((r) => setTimeout(r, 100));
      expect(onUploadFailed).not.toHaveBeenCalled();
    });
  });
});
