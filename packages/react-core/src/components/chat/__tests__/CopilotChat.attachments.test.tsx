import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
} from "../../../__tests__/utils/test-helpers";
import { CopilotChat } from "../CopilotChat";
import type { AttachmentUploadError } from "@copilotkit/shared";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { EMPTY } from "rxjs";

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

  describe("uploading guard across the in-flight-run await", () => {
    it("blocks the send and restores the typed text when an upload starts during the await window", async () => {
      // onSubmitInput checks the uploading guard, then (if a run is in flight)
      // awaits the run's completion before consuming attachments. If an upload
      // starts DURING that await, a guard taken only before the await would
      // miss it and consume/drop the in-progress attachment. The guard must be
      // re-checked against LIVE state after the await — blocking the send while
      // any attachment is still uploading, and RESTORING the optimistically
      // cleared composer text so the user's input is never silently lost.
      const agent = new MockStepwiseAgent();

      // Open the await window: a run is in flight with a settleable
      // completion promise. (Attached after the run is in flight below so the
      // connect/run setup does not overwrite it.)
      let resolveInFlight: () => void = () => {};
      const inFlight = new Promise<void>((resolve) => {
        resolveInFlight = resolve;
      });

      // Upload that we keep pending so the attachment stays "uploading".
      let resolveUpload: (v: {
        type: "url";
        value: string;
        mimeType?: string;
      }) => void = () => {};
      const onUpload = () =>
        new Promise<{ type: "url"; value: string; mimeType?: string }>(
          (resolve) => {
            resolveUpload = resolve;
          },
        );

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const addMessageSpy = vi.spyOn(agent, "addMessage");

      try {
        const { container } = renderWithCopilotKit({
          agent,
          children: (
            <CopilotChat
              welcomeScreen={false}
              attachments={{ enabled: true, onUpload }}
            />
          ),
        });

        const input = await screen.findByRole("textbox");

        // Run goes in flight (so the send will await its completion).
        agent.emit(runStartedEvent());
        await waitFor(() => {
          expect(agent.isRunning).toBe(true);
        });
        agent.setActiveRunCompletionPromise(inFlight);

        // No attachments yet — the pre-await guard passes. Fire the send; it
        // parks on the in-flight run's completion promise.
        fireEvent.change(input, {
          target: { value: "Send with no files yet" },
        });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

        // DURING the await, the user drops a file that begins uploading.
        const dropTarget = container.querySelector(
          '[data-testid="copilot-chat"]',
        );
        if (!dropTarget) throw new Error("no drop target");
        const file = createFile("late.png", 50, "image/png");
        await act(async () => {
          fireEvent.drop(dropTarget, {
            dataTransfer: { files: [file], types: ["Files"] },
          });
        });

        // The attachment is now "uploading" (onUpload still pending).
        await waitFor(() => {
          expect(
            container.querySelector('[data-testid="copilot-chat"]'),
          ).toBeTruthy();
        });

        // Release the in-flight run so the queued send resumes past the await.
        await act(async () => {
          resolveInFlight();
          await Promise.resolve();
        });

        // The re-checked guard blocks the send: the POST-AWAIT re-check fires
        // (distinct log message proves it ran after the await, not the
        // pre-await fast-fail) and no message is dispatched while the
        // attachment is still uploading.
        await waitFor(() => {
          expect(errorSpy).toHaveBeenCalledWith(
            "[CopilotKit] Cannot send while attachments are uploading (post-await re-check)",
          );
        });
        expect(addMessageSpy).not.toHaveBeenCalled();

        // The typed text is PRESERVED in the composer (restored on the blocked
        // path) so the user's input is never silently lost.
        await waitFor(() => {
          const composer = screen.getByRole("textbox") as HTMLTextAreaElement;
          expect(composer.value).toBe("Send with no files yet");
        });

        // Cleanup: let the pending upload resolve.
        await act(async () => {
          resolveUpload({ type: "url", value: "https://example.com/late.png" });
          await Promise.resolve();
        });
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
