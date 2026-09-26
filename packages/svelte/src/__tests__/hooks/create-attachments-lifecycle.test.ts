import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import LifecycleHarness from "./attachments-lifecycle-harness.svelte";
import ReactiveHarness from "./attachments-reactive-harness.svelte";

function textFile(name = "note.txt", content = "hello", type = "text/plain") {
  return new File([content], name, { type });
}

describe("createAttachments lifecycle parity slice", () => {
  it("binds container and file input refs via actions and clears on teardown", async () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const view = render(LifecycleHarness, {
      props: { config: { enabled: true }, files: [] },
    });

    await waitFor(() => {
      const parsed = JSON.parse(view.getByTestId("state").textContent!);
      expect(parsed.hasContainer).toBe(true);
      expect(parsed.hasFileInput).toBe(true);
    });

    view.unmount();

    expect(removeSpy).toHaveBeenCalledWith("paste", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("tracks reactive config getters", async () => {
    const view = render(ReactiveHarness);

    await waitFor(() => {
      const parsed = JSON.parse(
        view.getByTestId("reactive-state").textContent!,
      );
      expect(parsed.enabled).toBe(false);
    });

    await fireEvent.click(view.getByTestId("toggle"));

    await waitFor(() => {
      const parsed = JSON.parse(
        view.getByTestId("reactive-state").textContent!,
      );
      expect(parsed.enabled).toBe(true);
    });
  });

  it("rejects files outside the accept filter and reports invalid-type", async () => {
    const onUploadFailed = vi.fn();
    const onUpload = vi.fn().mockResolvedValue({
      type: "data" as const,
      value: "abc",
      mimeType: "image/png",
    });
    const view = render(LifecycleHarness, {
      props: {
        config: {
          enabled: true,
          accept: "image/png",
          onUpload,
          onUploadFailed,
        },
        files: [textFile("note.txt")],
      },
    });

    await fireEvent.click(view.getByTestId("process"));

    await waitFor(() => {
      expect(onUploadFailed).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "invalid-type" }),
      );
    });
    expect(onUpload).not.toHaveBeenCalled();
    const parsed = JSON.parse(view.getByTestId("state").textContent!);
    expect(parsed.count).toBe(0);
  });

  it("rejects oversized files and reports file-too-large", async () => {
    const onUploadFailed = vi.fn();
    const onUpload = vi.fn();
    const view = render(LifecycleHarness, {
      props: {
        config: { enabled: true, maxSize: 4, onUpload, onUploadFailed },
        files: [textFile("big.txt", "hello world")],
      },
    });

    await fireEvent.click(view.getByTestId("process"));

    await waitFor(() => {
      expect(onUploadFailed).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "file-too-large" }),
      );
    });
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("uploads valid files to ready state and consumes only ready attachments", async () => {
    const onUpload = vi.fn().mockResolvedValue({
      type: "data" as const,
      value: "YmFzZTY0",
      mimeType: "text/plain",
    });
    const view = render(LifecycleHarness, {
      props: {
        config: { enabled: true, onUpload },
        files: [textFile()],
      },
    });

    await fireEvent.click(view.getByTestId("process"));

    await waitFor(() => {
      const parsed = JSON.parse(view.getByTestId("state").textContent!);
      expect(parsed.count).toBe(1);
      expect(parsed.statuses).toEqual(["ready"]);
    });
    expect(onUpload).toHaveBeenCalledOnce();

    await fireEvent.click(view.getByTestId("consume"));

    await waitFor(() => {
      expect(
        JSON.parse(view.getByTestId("consumed").textContent!),
      ).toHaveLength(1);
      const parsed = JSON.parse(view.getByTestId("state").textContent!);
      expect(parsed.count).toBe(0);
    });

    // Consuming an empty queue returns [] without side effects.
    await fireEvent.click(view.getByTestId("consume"));
    await waitFor(() => {
      expect(JSON.parse(view.getByTestId("consumed").textContent!)).toEqual([]);
    });
  });

  it("removes an upload failure and reports upload-failed", async () => {
    const onUploadFailed = vi.fn();
    const onUpload = vi.fn().mockRejectedValue(new Error("boom"));
    const view = render(LifecycleHarness, {
      props: {
        config: { enabled: true, onUpload, onUploadFailed },
        files: [textFile()],
      },
    });

    await fireEvent.click(view.getByTestId("process"));

    await waitFor(() => {
      expect(onUploadFailed).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "upload-failed" }),
      );
    });
    const parsed = JSON.parse(view.getByTestId("state").textContent!);
    expect(parsed.count).toBe(0);
  });

  it("scopes paste to the container: inside enqueues, outside is ignored", async () => {
    const onUpload = vi.fn().mockResolvedValue({
      type: "data" as const,
      value: "YmFzZTY0",
      mimeType: "text/plain",
    });
    const view = render(LifecycleHarness, {
      props: { config: { enabled: true, onUpload }, files: [] },
    });

    await waitFor(() => {
      const parsed = JSON.parse(view.getByTestId("state").textContent!);
      expect(parsed.hasContainer).toBe(true);
    });

    const file = textFile();
    const makePaste = () => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          items: [
            {
              kind: "file",
              getAsFile: () => file,
            },
          ],
        },
      });
      return event;
    };

    view.getByTestId("outside").dispatchEvent(makePaste());
    await waitFor(() => {
      const parsed = JSON.parse(view.getByTestId("state").textContent!);
      expect(parsed.count).toBe(0);
    });
    expect(onUpload).not.toHaveBeenCalled();

    view.getByTestId("inside").dispatchEvent(makePaste());
    await waitFor(() => {
      const parsed = JSON.parse(view.getByTestId("state").textContent!);
      expect(parsed.count).toBe(1);
    });
    expect(onUpload).toHaveBeenCalledOnce();
  });
});
