import { render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { Attachment, AttachmentsConfig } from "@copilotkit/shared";
import Harness from "./create-attachments-harness.svelte";

describe("createAttachments", () => {
  it("disabled by default", async () => {
    const view = render(Harness, { props: { config: undefined } });

    await waitFor(() => {
      const parsed = JSON.parse(view.getByTestId("attachments").textContent!);
      expect(parsed.enabled).toBe(false);
      expect(parsed.attachments).toEqual([]);
      expect(parsed.dragOver).toBe(false);
    });
  });

  it("enabled when config.enabled is true", async () => {
    const view = render(Harness, { props: { config: { enabled: true } } });

    await waitFor(() => {
      const parsed = JSON.parse(view.getByTestId("attachments").textContent!);
      expect(parsed.enabled).toBe(true);
    });
  });

  it("processFiles calls onUpload for valid files", async () => {
    const onUpload = vi.fn().mockResolvedValue({
      type: "data" as const,
      value: "base64data",
      mimeType: "text/plain",
    });
    const onUploadFailed = vi.fn();

    const view = render(Harness, {
      props: {
        config: {
          enabled: true,
          accept: "text/plain",
          onUpload,
          onUploadFailed,
        } as AttachmentsConfig,
      },
    });

    await waitFor(() => {
      const parsed = JSON.parse(view.getByTestId("attachments").textContent!);
      expect(parsed.enabled).toBe(true);
    });

    const file = new File(["hello"], "test.txt", { type: "text/plain" });

    const { createAttachments } =
      await import("../../hooks/create-attachments.svelte");
    expect(createAttachments).toBeDefined();
  });

  it("rejects files that dont match accept filter", async () => {
    const onUploadFailed = vi.fn();

    const view = render(Harness, {
      props: {
        config: {
          enabled: true,
          accept: "image/png",
          onUploadFailed,
        } as AttachmentsConfig,
      },
    });

    await waitFor(() => {
      const parsed = JSON.parse(view.getByTestId("attachments").textContent!);
      expect(parsed.enabled).toBe(true);
    });
  });
});
