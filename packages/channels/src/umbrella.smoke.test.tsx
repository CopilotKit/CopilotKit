import { describe, expect, it } from "vitest";
import { createChannel, Message, Button } from "@copilotkit/channels";
import { runStateStoreConformance } from "@copilotkit/channels/testing";
import { slack } from "@copilotkit/channels/slack";
import { teams } from "@copilotkit/channels/teams";
import { intelligenceAdapter } from "@copilotkit/channels/intelligence";
import * as intelligence from "@copilotkit/channels/intelligence";
import { discord } from "@copilotkit/channels/discord";
import { telegram } from "@copilotkit/channels/telegram";
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
      intelligenceAdapter,
      discord,
      telegram,
      whatsapp,
      renderSlackMessage,
      renderAdaptiveCard,
    ]) {
      expect(typeof value).toBe("function");
    }
    expect(typeof slackCodec).toBe("object");
  });

  it("keeps Intelligence gateway and bootstrap internals private", () => {
    expect(Object.keys(intelligence).sort()).toEqual(["intelligenceAdapter"]);
  });
});
