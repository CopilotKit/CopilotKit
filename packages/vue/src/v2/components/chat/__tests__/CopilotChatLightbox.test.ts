import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { fireEvent, render, screen } from "@testing-library/vue";
import CopilotChatAttachmentRenderer from "../CopilotChatAttachmentRenderer.vue";

// Ported from react-core's lightbox and attachment renderer behavior.

const image = {
  type: "image" as const,
  source: { type: "url" as const, value: "https://example.com/cat.png" },
};

async function openLightbox() {
  const result = render(CopilotChatAttachmentRenderer, { props: image });
  const thumbnail = screen.getByRole("button", { name: "Image attachment" });
  thumbnail.focus();
  await fireEvent.click(thumbnail);
  await nextTick();
  return { ...result, thumbnail };
}

describe("CopilotChatAttachmentRenderer lightbox", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens the image full size in a lightbox portalled to the body", async () => {
    const { container } = await openLightbox();

    const dialog = screen.getByRole("dialog", { name: "Image attachment" });
    expect(dialog.classList.contains("cpk-attachment-lightbox")).toBe(true);
    expect(container.contains(dialog)).toBe(false);
    const full = dialog.querySelector("img");
    expect(full?.getAttribute("src")).toBe("https://example.com/cat.png");
    expect(
      full?.classList.contains("cpk-attachment-renderer-lightbox-image"),
    ).toBe(true);
  });

  it("names the close button and moves focus to it", async () => {
    await openLightbox();
    const close = screen.getByRole("button", { name: "Close preview" });
    expect(
      close.classList.contains("cpk-attachment-lightbox-close-button"),
    ).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it("closes on Escape and returns focus to the thumbnail", async () => {
    const { thumbnail } = await openLightbox();
    await fireEvent.keyDown(document, { key: "Escape" });
    await nextTick();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(thumbnail);
  });

  it("closes on the close button and on a backdrop click, not a content click", async () => {
    await openLightbox();
    await fireEvent.click(screen.getByRole("dialog").querySelector("img")!);
    expect(screen.queryByRole("dialog")).not.toBeNull();

    await fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();

    await fireEvent.click(
      screen.getByRole("button", { name: "Image attachment" }),
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Close preview" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Tab inside the lightbox", async () => {
    await openLightbox();
    const close = screen.getByRole("button", { name: "Close preview" });
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    close.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it("morphs the thumbnail with a view transition when the browser has one", async () => {
    const names: string[] = [];
    const startViewTransition = vi.fn((callback: () => Promise<void>) => {
      const thumbnail = document.querySelector<HTMLElement>(
        ".cpk-attachment-renderer-image",
      )!;
      names.push(thumbnail.style.viewTransitionName);
      const done = callback();
      return { finished: done.then(() => undefined) };
    });
    Object.defineProperty(document, "startViewTransition", {
      value: startViewTransition,
      configurable: true,
    });
    try {
      await openLightbox();
      await nextTick();
      expect(startViewTransition).toHaveBeenCalledTimes(1);
      // The name is on the thumbnail before the transition, then on the
      // lightbox image.
      expect(names[0]).toMatch(/^cpk-lightbox-/);
      const full = screen.getByRole("dialog").querySelector("img")!;
      expect(full.style.viewTransitionName).toBe(names[0]);
      expect(
        document.querySelector<HTMLElement>(".cpk-attachment-renderer-image")!
          .style.viewTransitionName,
      ).toBe("");
    } finally {
      delete (document as { startViewTransition?: unknown })
        .startViewTransition;
    }
  });
});

describe("CopilotChatAttachmentRenderer document link", () => {
  it("links a document attachment to its resolved source URL", () => {
    const href =
      "https://files.example.test/download/document.pdf?signature=preserved";
    render(CopilotChatAttachmentRenderer, {
      props: {
        type: "document",
        source: { type: "url", value: href, mimeType: "application/pdf" },
        filename: "document.pdf",
      },
    });

    const link = screen.getByRole("link", { name: "document.pdf" });
    expect(link.getAttribute("href")).toBe(href);
    expect(link.getAttribute("download")).toBe("document.pdf");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("document.pdf");
  });

  it("keeps a data URL downloadable when no filename is known", () => {
    render(CopilotChatAttachmentRenderer, {
      props: {
        type: "document",
        source: {
          type: "data",
          value: "JVBERi0=",
          mimeType: "application/pdf",
        },
      },
    });

    const link = screen.getByRole("link", { name: "application/pdf" });
    expect(link.getAttribute("href")).toBe(
      "data:application/pdf;base64,JVBERi0=",
    );
    expect(link.getAttribute("download")).toBe("");
  });
});
