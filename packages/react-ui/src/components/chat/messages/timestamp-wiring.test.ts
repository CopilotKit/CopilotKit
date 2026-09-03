import { readFileSync } from "fs";
import { resolve } from "path";

const modalPath = resolve(__dirname, "../Modal.tsx");
const messageTimestampPath = resolve(__dirname, "./MessageTimestamp.tsx");
const hookPath = resolve(
  __dirname,
  "../../../../../react-core/src/v1-deprecated/hooks/use-copilot-chat_internal.ts",
);
const sharedMessagePath = resolve(
  __dirname,
  "../../../../../shared/src/types/message.ts",
);

const modalSrc = readFileSync(modalPath, "utf-8");
const messageTimestampSrc = readFileSync(messageTimestampPath, "utf-8");
const hookSrc = readFileSync(hookPath, "utf-8");
const sharedMessageSrc = readFileSync(sharedMessagePath, "utf-8");

describe("message timestamp wiring", () => {
  it("passes showTimestamps through CopilotModal's provider path", () => {
    expect(modalSrc).toMatch(/showTimestamps=\{showTimestamps\}/);
  });

  it("suppresses hydration warnings for locale-formatted timestamps", () => {
    expect(messageTimestampSrc).toMatch(/suppressHydrationWarning/);
  });

  it("stamps newly materialized assistant messages during active runs", () => {
    expect(hookSrc).toMatch(/assistantMessageTimestampsRef/);
    expect(hookSrc).toMatch(
      /!seenAssistantMessageIdsRef\.current\.has\(message\.id\)/,
    );
    expect(hookSrc).toMatch(/timestamp: stampedTimestamp/);
  });

  it("documents that restored threads need persisted timestamps", () => {
    expect(sharedMessageSrc).toMatch(
      /Restored threads only show timestamps when this field is persisted/,
    );
  });
});
