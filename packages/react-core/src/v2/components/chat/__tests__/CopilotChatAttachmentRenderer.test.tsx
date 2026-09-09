import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import { CopilotChatAttachmentRenderer } from "../CopilotChatAttachmentRenderer";

describe("CopilotChatAttachmentRenderer", () => {
  it("links a document attachment to its resolved source URL", () => {
    const href =
      "https://files.example.test/download/document.pdf?signature=preserved";

    render(
      <CopilotChatAttachmentRenderer
        type="document"
        source={{
          type: "url",
          value: href,
          mimeType: "application/pdf",
        }}
        filename="document.pdf"
      />,
    );

    const link = screen.getByRole("link", { name: "document.pdf" });

    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("download", "document.pdf");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("document.pdf");
  });

  it("keeps a data URL downloadable when no filename is known", () => {
    const href = "data:application/pdf;base64,JVBERi0=";

    render(
      <CopilotChatAttachmentRenderer
        type="document"
        source={{ type: "base64", value: "JVBERi0=", mimeType: "application/pdf" }}
      />,
    );

    const link = screen.getByRole("link", { name: "application/pdf" });

    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("download", "");
  });
});
