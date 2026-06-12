import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/vue";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable, EMPTY } from "rxjs";
import CopilotChat from "../CopilotChat.vue";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../../__tests__/utils/test-helpers";
import type { AttachmentUploadError } from "@copilotkit/shared";

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
  onUpload?: (file: File) => unknown;
}) {
  const agent = new NoopAgent();
  return renderWithCopilotKit({
    agent,
    children: {
      components: { CopilotChat },
      data() {
        return { props };
      },
      template: `
        <div style="height: 400px;">
          <CopilotChat
            :welcome-screen="false"
            :attachments="{
              enabled: true,
              accept: props.accept,
              maxSize: props.maxSize,
              onUploadFailed: props.onUploadFailed,
              onUpload: props.onUpload
            }"
          />
        </div>
      `,
    },
  });
}

async function dropFiles(container: HTMLElement, files: File[]) {
  const dropTarget = container.querySelector(
    '[data-testid="copilot-chat-view"]',
  );
  if (!dropTarget) {
    throw new Error("Could not find copilot-chat drop target");
  }

  await fireEvent.dragOver(dropTarget, {
    dataTransfer: { files, types: ["Files"] },
  });
  await fireEvent.drop(dropTarget, {
    dataTransfer: { files, types: ["Files"] },
  });
}

describe("CopilotChat attachments", () => {
  describe("stability", () => {
    it("keeps attachment action identities stable across input-only rerenders", async () => {
      const captures: Array<{
        onAddFile: unknown;
        onRemoveAttachment: unknown;
      }> = [];

      const agent = new NoopAgent();
      const { getByTestId } = renderWithCopilotKit({
        agent,
        children: {
          components: { CopilotChat },
          methods: {
            capture(slotProps: Record<string, unknown>) {
              captures.push({
                onAddFile: slotProps.onAddFile,
                onRemoveAttachment: slotProps.onRemoveAttachment,
              });
            },
          },
          template: `
            <div style="height: 400px;">
              <CopilotChat
                :welcome-screen="false"
                :attachments="{ enabled: true }"
              >
                <template #chat-view="slotProps">
                  <button data-testid="capture-bindings" @click="capture(slotProps)">
                    capture
                  </button>
                  <button data-testid="type-a" @click="slotProps.onInputChange('a')">
                    type-a
                  </button>
                  <button data-testid="type-b" @click="slotProps.onInputChange('ab')">
                    type-b
                  </button>
                  <button data-testid="type-c" @click="slotProps.onInputChange('abc')">
                    type-c
                  </button>
                </template>
              </CopilotChat>
            </div>
          `,
        },
      });

      await fireEvent.click(getByTestId("capture-bindings"));
      await fireEvent.click(getByTestId("type-a"));
      await fireEvent.click(getByTestId("type-b"));
      await fireEvent.click(getByTestId("type-c"));
      await fireEvent.click(getByTestId("capture-bindings"));

      expect(captures).toHaveLength(2);
      expect(captures[1].onAddFile).toBe(captures[0].onAddFile);
      expect(captures[1].onRemoveAttachment).toBe(
        captures[0].onRemoveAttachment,
      );
    });
  });

  describe("onUploadFailed", () => {
    it("fires with invalid-type when file does not match accept filter", async () => {
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

    it("fires with file-too-large when file exceeds maxSize", async () => {
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

    it("fires with upload-failed when onUpload throws", async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(onUploadFailed).not.toHaveBeenCalled();
    });
  });
});
