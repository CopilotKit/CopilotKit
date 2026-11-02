import { describe, it, expect, vi, afterEach } from "vitest";
import {
  Actions,
  Button,
  Input,
  Message,
  Select,
} from "@copilotkit/channels-ui";
import type { Renderable } from "@copilotkit/channels-ui";
import { startSlackHarness, stopSlackHarnesses } from "./slack-harness.js";
import type { SlackHarness } from "./slack-harness.js";

/**
 * `thread.awaitChoice` on the real Slack adapter: every control of the picker
 * must be able to answer it, whatever action id Slack would otherwise derive
 * for that control.
 */

const PENDING = Symbol("pending");

/**
 * Start a channel whose mention handler awaits `picker()` and records the
 * answer. `before` runs first in the same turn (e.g. to post other cards).
 */
async function startPicker(
  picker: () => Renderable,
  before?: (post: (ui: Renderable) => Promise<unknown>) => Promise<void>,
) {
  const state = { chosen: PENDING as unknown, settled: 0 };
  const slack = await startSlackHarness({
    setup: (channel) => {
      channel.onMention(async ({ thread }) => {
        if (before) await before((ui) => thread.post(ui));
        state.chosen = await thread.awaitChoice(picker());
        state.settled++;
      });
    },
  });
  return { slack, state };
}

async function mentionAndGetPicker(slack: SlackHarness, ts = "100.0001") {
  await slack.mention({ channel: "C1", user: "U1", ts });
  return slack.posts.at(-1)!;
}

describe("Slack awaitChoice: every picker control can answer it", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await stopSlackHarnesses();
  });

  it("resolves from a value-only button whose value is longer than Slack's action_id limit", async () => {
    const value = { note: "x".repeat(300) };
    const { slack, state } = await startPicker(() =>
      Actions({ children: [Button({ value, children: "Approve" })] }),
    );
    const picker = await mentionAndGetPicker(slack);
    const button = picker.elements[0]!;
    expect(button.action_id.length).toBeLessThanOrEqual(255);

    await slack.click({ message: picker, element: button, user: "U1" });
    expect(state.chosen).toEqual(value);
  });

  it("resolves from a button with neither a handler nor a value", async () => {
    const { slack, state } = await startPicker(() =>
      Actions({ children: [Button({ children: "Acknowledge" })] }),
    );
    const picker = await mentionAndGetPicker(slack);

    await slack.click({
      message: picker,
      element: picker.elements[0]!,
      user: "U1",
    });
    expect(state.settled).toBe(1);
    expect(state.chosen).toBeUndefined();
  });

  it("resolves from a text input without a handler", async () => {
    const { slack, state } = await startPicker(() =>
      Message({ children: [Input({ placeholder: "Reason" })] }),
    );
    const picker = await mentionAndGetPicker(slack);
    const input = picker.elements.find((e) => e.type === "plain_text_input")!;

    await slack.click({
      message: picker,
      element: input,
      user: "U1",
      override: { value: "ship it" },
    });
    expect(state.chosen).toBe("ship it");
  });
});

describe("Slack awaitChoice: only the picker's own controls answer it", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await stopSlackHarnesses();
  });

  const pickOne = () =>
    Actions({
      children: [
        Select({
          placeholder: "Pick",
          options: [
            { label: "Ten", value: "10" },
            { label: "Twenty", value: "20" },
          ],
        }),
      ],
    });

  it("is not answered by an earlier value-only button with the same value", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const value = { approved: true };
    const { slack, state } = await startPicker(
      () => Actions({ children: [Button({ value, children: "Approve" })] }),
      async (post) => {
        await post(Actions({ children: [Button({ value, children: "Old" })] }));
      },
    );
    const picker = await mentionAndGetPicker(slack);
    const old = slack.posts[0]!;

    await slack.click({ message: old, element: old.elements[0]!, user: "U1" });
    expect(state.chosen).toBe(PENDING);

    await slack.click({
      message: picker,
      element: picker.elements[0]!,
      user: "U1",
    });
    expect(state.chosen).toEqual(value);
  });

  it("is not answered by an earlier handler-less select", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { slack, state } = await startPicker(pickOne, async (post) => {
      await post(pickOne());
    });
    const picker = await mentionAndGetPicker(slack);
    const old = slack.posts[0]!;
    const chooseTwenty = {
      selected_option: {
        text: { type: "plain_text", text: "Twenty" },
        value: "20",
      },
    };

    await slack.click({
      message: old,
      element: old.elements[0]!,
      user: "U1",
      override: chooseTwenty,
    });
    expect(state.chosen).toBe(PENDING);

    await slack.click({
      message: picker,
      element: picker.elements[0]!,
      user: "U1",
      override: chooseTwenty,
    });
    // Slack round-trips the option as "20" and decodes it as JSON; the picker
    // answers with its own option value.
    expect(state.chosen).toBe("20");
  });

  it("refuses a select option the picker does not offer", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { slack, state } = await startPicker(pickOne);
    const picker = await mentionAndGetPicker(slack);

    await slack.click({
      message: picker,
      element: picker.elements[0]!,
      user: "U1",
      override: {
        selected_option: {
          text: { type: "plain_text", text: "x" },
          value: "999",
        },
      },
    });
    expect(state.chosen).toBe(PENDING);
  });
});

describe("Slack awaitChoice: option values Slack would decode as JSON", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await stopSlackHarnesses();
  });

  const tricky = ["9.90", "1e3", "null", "true", '{"id":1}', '["a"]'];

  it.each(tricky)("answers with the offered option %s", async (offered) => {
    const { slack, state } = await startPicker(() =>
      Actions({
        children: [
          Select({
            placeholder: "Pick",
            options: [
              { label: "Other", value: "other" },
              { label: "Tricky", value: offered },
            ],
          }),
        ],
      }),
    );
    const picker = await mentionAndGetPicker(slack);

    await slack.click({
      message: picker,
      element: picker.elements[0]!,
      user: "U1",
      override: {
        selected_option: {
          text: { type: "plain_text", text: "Tricky" },
          value: offered,
        },
      },
    });
    expect(slack.errors).toEqual([]);
    expect(state.chosen).toBe(offered);
  });

  it("tells apart two options whose values decode to the same JSON", async () => {
    const { slack, state } = await startPicker(() =>
      Actions({
        children: [
          Select({
            placeholder: "Pick",
            options: [
              { label: "Short", value: "9.9" },
              { label: "Long", value: "9.90" },
            ],
          }),
        ],
      }),
    );
    const picker = await mentionAndGetPicker(slack);

    await slack.click({
      message: picker,
      element: picker.elements[0]!,
      user: "U1",
      override: {
        selected_option: {
          text: { type: "plain_text", text: "Long" },
          value: "9.90",
        },
      },
    });
    expect(state.chosen).toBe("9.90");
  });
});

describe("Slack awaitChoice from a slash command", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await stopSlackHarnesses();
  });

  it("resolves from a click on the picker posted in reply to the command", async () => {
    const state = { chosen: PENDING as unknown };
    const slack = await startSlackHarness({
      setup: (channel) => {
        channel.onCommand("/deploy", async ({ thread }) => {
          state.chosen = await thread.awaitChoice(
            Actions({
              children: [Button({ value: { env: "prod" }, children: "Prod" })],
            }),
          );
        });
        channel.onMention(async () => {});
      },
    });
    await slack.slash({ channel: "C1", user: "U1" });
    const picker = slack.posts.at(-1)!;
    expect(picker.threadTs).toBeUndefined();

    await slack.click({
      message: picker,
      element: picker.elements[0]!,
      user: "U1",
    });
    expect(state.chosen).toEqual({ env: "prod" });
  });
});

describe("Slack awaitChoice: refused clicks", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await stopSlackHarnesses();
  });

  it("tells someone other than the initiator, in an ephemeral message, that they cannot answer", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { slack, state } = await startPicker(() =>
      Actions({
        children: [Button({ value: { ok: true }, children: "Approve" })],
      }),
    );
    const picker = await mentionAndGetPicker(slack);

    await slack.click({
      message: picker,
      element: picker.elements[0]!,
      user: "U2",
    });
    expect(state.chosen).toBe(PENDING);
    expect(slack.ephemerals).toHaveLength(1);
    expect(slack.ephemerals[0]).toMatchObject({ channel: "C1", user: "U2" });
    expect(JSON.stringify(slack.ephemerals[0]!.blocks)).toContain(
      "Only the person who started this can answer it.",
    );
  });
});
