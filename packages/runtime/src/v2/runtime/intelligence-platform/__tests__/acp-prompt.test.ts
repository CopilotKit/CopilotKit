import { expect, test } from "vitest";
import { AcpPromptError, selectLatestAcpPrompt } from "../acp-prompt";

test("selects only the final AG-UI user message", () => {
  expect(
    selectLatestAcpPrompt([
      { id: "user-1", role: "user", content: "First" },
      { id: "assistant-1", role: "assistant", content: "Answer" },
      { id: "user-2", role: "user", content: "Follow up" },
    ]),
  ).toEqual([{ type: "text", text: "Follow up" }]);
});

test("maps inline and linked media without losing their ACP content", () => {
  expect(
    selectLatestAcpPrompt([
      {
        id: "user-1",
        role: "user",
        content: [
          { type: "text", text: "Inspect these" },
          {
            type: "image",
            source: {
              type: "data",
              value: "aGVsbG8=",
              mimeType: "image/png",
            },
          },
          {
            type: "document",
            source: {
              type: "url",
              value: "https://example.com/report.pdf",
              mimeType: "application/pdf",
            },
          },
        ],
      },
    ]),
  ).toEqual([
    { type: "text", text: "Inspect these" },
    { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    {
      type: "resource_link",
      name: "document",
      uri: "https://example.com/report.pdf",
      mimeType: "application/pdf",
    },
  ]);
});

test("rejects a run whose last message is not a new user prompt", () => {
  expect(() =>
    selectLatestAcpPrompt([
      { id: "user-1", role: "user", content: "First" },
      { id: "assistant-1", role: "assistant", content: "Answer" },
    ]),
  ).toThrowError(AcpPromptError);
});
