import { expect, it } from "vitest";
import type { PostFileResult } from "./types.js";

it("retains the legacy file and managed asset identifiers in the public result", () => {
  const result: PostFileResult = {
    ok: true,
    messageId: "M1",
    fileId: "M1",
    assetId: "A1",
    messageRef: { id: "M1", channel: "C1" },
  };

  expect(result.fileId).toBe("M1");
  expect(result.assetId).toBe("A1");
  expect(result.messageRef?.channel).toBe("C1");
});
