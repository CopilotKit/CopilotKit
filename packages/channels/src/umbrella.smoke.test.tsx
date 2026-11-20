import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createChannel, Message, Button } from "@copilotkit/channels";
import { runStateStoreConformance } from "@copilotkit/channels/testing";
import { slack } from "@copilotkit/channels/slack";
import { teams } from "@copilotkit/channels/teams";
import { discord } from "@copilotkit/channels/discord";
import { whatsapp } from "@copilotkit/channels/whatsapp";
import { slackCodec } from "@copilotkit/channels/slack/codec";
import { renderSlackMessage } from "@copilotkit/channels/slack/render";
import { renderAdaptiveCard } from "@copilotkit/channels/teams/render";

describe("@copilotkit/channels umbrella", () => {
  it("exposes the existing engine, testing API, and JSX vocabulary", () => {
    const view = (
      <Message>
        <Button>OK</Button>
      </Message>
    );
    expect(typeof createChannel).toBe("function");
    expect(typeof runStateStoreConformance).toBe("function");
    expect(view.type).toBe(Message);
  });

  it("exposes every adapter and supported nested entry", () => {
    for (const value of [
      slack,
      teams,
      discord,
      whatsapp,
      renderSlackMessage,
      renderAdaptiveCard,
    ]) {
      expect(typeof value).toBe("function");
    }
    expect(typeof slackCodec).toBe("object");
  });

  it("does not resolve the retired /telegram entry", () => {
    const result = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "try { console.log(import.meta.resolve(process.argv[1])); } catch (error) { console.log(error.code); }",
        "@copilotkit/channels/telegram",
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
      },
    );
    expect(result.trim()).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
  });
});
