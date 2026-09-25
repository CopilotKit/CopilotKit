// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAutopilot } from "../autopilot/browser-autopilot";
import type { BrowserAutopilotHost } from "../autopilot/browser-autopilot";
import type { BrowserActionOutcome } from "../autopilot/browser-action";
import { performBrowserAction } from "../autopilot/browser-action";
import { HttpAgent } from "@ag-ui/client";
import type { FrontendToolHandlerContext } from "../types";

let held: Set<string>;
let cleanup: Array<() => void>;
beforeEach(() => {
  held = new Set();
  cleanup = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      async request(
        name: string,
        optionsOrWork: unknown,
        callback?: (lock: unknown) => Promise<unknown>,
      ) {
        const work =
          callback ?? (optionsOrWork as (lock: unknown) => Promise<unknown>);
        if (held.has(name)) return work(null);
        held.add(name);
        try {
          return await work({ name });
        } finally {
          held.delete(name);
        }
      },
    },
  });
  document.body.innerHTML = `<main data-copilot-page>
    <form aria-label="Edit item" data-autopilot-record-id="one" data-autopilot-record-version="1" data-autopilot-handler-version="1">
      <label>Destination<input name="destination" value="Seattle"></label>
      <label>Notes<input name="notes" value="original"></label>
      <button type="submit">Save</button>
    </form>
    <div data-autopilot-record-id="one" data-autopilot-record-version="1"><button type="button" data-copilot-action="archive" data-autopilot-handler-version="1">Archive</button></div>
  </main>`;
});
afterEach(() => {
  cleanup.forEach((fn) => fn());
  vi.restoreAllMocks();
});

function context(threadId = "thread"): FrontendToolHandlerContext {
  const agent = new HttpAgent({ url: "http://localhost/api" });
  agent.agentId = "agent";
  agent.threadId = threadId;
  agent.messages = [{ role: "user", id: "request", content: "Update item" }];
  return {
    agent,
    toolCall: {
      id: "call",
      type: "function",
      function: { name: "autopilot_submitForm", arguments: "{}" },
    },
  };
}
function setup(overrides: Partial<BrowserAutopilotHost> = {}) {
  const host: BrowserAutopilotHost = {
    adapter: () => ({
      identity: { userId: "user", organizationId: "org" },
      canWrite: async () => true,
      navigation: {
        push: vi.fn(),
        allowedPath: () => true,
        mayLeave: () => true,
      },
    }),
    enabled: () => true,
    approve: vi.fn(async () => "approved" as const),
    clarify: vi.fn(),
    settled: vi.fn(),
    notice: vi.fn(),
    ...overrides,
  };
  const browser = new BrowserAutopilot(host);
  cleanup.push(browser.mount());
  const controls = browser.pageMap.read().controls;
  const input = document.querySelector<HTMLInputElement>(
    '[name="destination"]',
  )!;
  const form = document.querySelector("form")!;
  const work = vi.fn(
    async (): Promise<BrowserActionOutcome> => ({
      status: "completed",
      recordId: "one",
      version: 2,
    }),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void performBrowserAction(form, event, work);
  });
  const submit = (ctx = context()) =>
    browser.submit(
      [
        {
          ref: controls.find((item) => item.name === "Destination")!.ref,
          value: "Portland",
        },
      ],
      controls.find((item) => item.name === "Save")!.ref,
      ctx,
    );
  return { browser, host, input, form, work, submit, controls };
}

describe("provider-owned browser session", () => {
  it("runs discovered forms through review and the ordinary handler's receipt", async () => {
    const { submit, input, work, host } = setup();
    expect(await submit()).toMatchObject({
      status: "completed",
      recordId: "one",
      version: 2,
    });
    expect(host.approve).toHaveBeenCalledOnce();
    expect(input.value).toBe("Portland");
    expect(work).toHaveBeenCalledOnce();
    expect(window.sessionStorage.length).toBe(0);
  });
  it("refuses a synthetic application write without an approved dispatch", async () => {
    const { form, work } = setup();
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(work).not.toHaveBeenCalled();
  });
  it("does not fill or dispatch when review is declined", async () => {
    const { submit, input, work } = setup({ approve: async () => "declined" });
    expect(await submit()).toMatchObject({ status: "denied" });
    expect(input.value).toBe("Seattle");
    expect(work).not.toHaveBeenCalled();
  });
  it.each(["readonly", "disabled", "sibling", "handler"])(
    "revalidates %s changes made during review",
    async (kind) => {
      const { submit, input, work } = setup({
        approve: async () => {
          if (kind === "readonly")
            document.querySelector("input")!.readOnly = true;
          if (kind === "disabled")
            document.querySelector("button")!.disabled = true;
          if (kind === "sibling")
            document.querySelector<HTMLInputElement>('[name="notes"]')!.value =
              "unreviewed";
          if (kind === "handler")
            document
              .querySelector("form")!
              .setAttribute("data-autopilot-handler-version", "2");
          return "approved";
        },
      });
      expect(await submit()).toMatchObject({ status: "denied" });
      expect(input.value).toBe("Seattle");
      expect(work).not.toHaveBeenCalled();
    },
  );
  it("refuses an unrelated field change during its own fill without submitting", async () => {
    const { submit, input, work, host } = setup();
    input.addEventListener("input", () => {
      document.querySelector<HTMLInputElement>('[name="notes"]')!.value =
        "manual draft";
    });
    expect(await submit()).toMatchObject({ status: "partial" });
    expect(work).not.toHaveBeenCalled();
    expect(host.notice).toHaveBeenCalledWith(
      expect.stringContaining("not submitted"),
    );
  });
  it("honors takeover after approval but before the app handler starts", async () => {
    const { browser, submit, input, work } = setup();
    input.addEventListener("input", () => browser.cancel("User takeover"));
    expect(await submit()).toMatchObject({ status: "partial" });
    expect(work).not.toHaveBeenCalled();
  });
  it("uses the same review/receipt path for arbitrary discovered buttons", async () => {
    const { browser, controls, work, host } = setup();
    const button = document.querySelector<HTMLButtonElement>(
      "[data-copilot-action]",
    )!;
    button.addEventListener("click", (event) => {
      void performBrowserAction(button, event, work);
    });
    expect(
      await browser.activate(
        controls.find((item) => item.name === "Archive")!.ref,
        context(),
      ),
    ).toMatchObject({ status: "completed" });
    expect(host.approve).toHaveBeenCalledOnce();
    expect(work).toHaveBeenCalledOnce();
  });
  it("holds a record lock across review in separate browser sessions", async () => {
    let release!: () => void;
    const first = setup({
      approve: () =>
        new Promise((resolve) => {
          release = () => resolve("approved");
        }),
    });
    const second = setup();
    const pending = first.submit();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(await second.submit(context("another-thread"))).toMatchObject({
      status: "denied",
      reason: expect.stringContaining("Another tab"),
    });
    expect(second.host.approve).not.toHaveBeenCalled();
    release();
    expect(await pending).toMatchObject({ status: "completed" });
    expect(held.size).toBe(0);
  });
  it("bounds all page reads for a request", async () => {
    const { browser } = setup();
    for (let i = 0; i < 12; i++) await browser.read(context());
    expect(await browser.read(context())).toMatchObject({ status: "denied" });
    expect(await browser.find("Save", context())).toMatchObject({
      status: "denied",
    });
  });
  it("preserves uncertain receipts across remount without repeating an action", async () => {
    const { submit, work, browser } = setup();
    work.mockResolvedValueOnce({ status: "uncertain" });
    expect(await submit()).toMatchObject({ status: "uncertain" });
    const remount = setup();
    expect(remount.host.notice).toHaveBeenCalledWith(
      expect.stringContaining("Outcome unconfirmed"),
    );
    expect(work).toHaveBeenCalledOnce();
    browser.dismissNotice();
    expect(sessionStorage.length).toBe(0);
  });
  it.each(["session", "agent", "request", "call"])(
    "invalidates an approval when %s identity changes",
    async (kind) => {
      const ctx = context();
      const adapter = {
        identity: { userId: "user", organizationId: "org" },
        canWrite: async () => true,
        navigation: {
          push: vi.fn(),
          allowedPath: () => true,
          mayLeave: () => true,
        },
      };
      const { submit, work } = setup({
        adapter: () => adapter,
        approve: async () => {
          if (kind === "session") adapter.identity.userId = "other";
          if (kind === "agent") ctx.agent!.agentId = "other";
          if (kind === "request")
            ctx.agent!.messages.push({
              id: "new-request",
              role: "user",
              content: "Stop that",
            });
          if (kind === "call") ctx.toolCall.id = "other-call";
          return "approved";
        },
      });
      expect(await submit(ctx)).toMatchObject({ status: "denied" });
      expect(work).not.toHaveBeenCalled();
    },
  );

  it("expires a pending review without leaving a record lock or writable grant", async () => {
    vi.useFakeTimers();
    try {
      const { submit, work } = setup({
        approve: (_review, signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => resolve("cancelled"), {
              once: true,
            });
          }),
      });
      const result = submit();
      await vi.advanceTimersByTimeAsync(60_001);
      expect(await result).toMatchObject({ status: "cancelled" });
      expect(work).not.toHaveBeenCalled();
      expect(held.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reuse a button approval for a second synthetic event", async () => {
    const { browser, controls, work } = setup();
    const button = document.querySelector<HTMLButtonElement>(
      "[data-copilot-action]",
    )!;
    button.addEventListener("click", (event) => {
      void performBrowserAction(button, event, work);
    });
    await browser.activate(
      controls.find((item) => item.name === "Archive")!.ref,
      context(),
    );
    button.click();
    await Promise.resolve();
    expect(work).toHaveBeenCalledOnce();
  });
  it.each(["insert", "name", "disabled", "owner"])(
    "rejects unreviewed form structure changes: %s",
    async (kind) => {
      const { submit, input, work } = setup();
      input.addEventListener("input", () => {
        const sibling =
          document.querySelector<HTMLInputElement>('[name="notes"]')!;
        if (kind === "insert")
          input.form!.insertAdjacentHTML(
            "beforeend",
            '<input type="hidden" name="unreviewed" value="yes">',
          );
        if (kind === "name") sibling.name = "other";
        if (kind === "disabled") sibling.disabled = true;
        if (kind === "owner") sibling.setAttribute("form", "elsewhere");
      });
      expect(await submit()).toMatchObject({ status: "partial" });
      expect(work).not.toHaveBeenCalled();
    },
  );

  it("rechecks identity after the final asynchronous authorization", async () => {
    const ctx = context();
    let calls = 0;
    const { submit, work } = setup({
      adapter: () => ({
        identity: { userId: "user", organizationId: "org" },
        navigation: {
          push: vi.fn(),
          allowedPath: () => true,
          mayLeave: () => true,
        },
        canWrite: async () => {
          if (++calls === 4) ctx.toolCall.id = "new-call";
          return true;
        },
      }),
    });
    expect(await submit(ctx)).toMatchObject({ status: "partial" });
    expect(work).not.toHaveBeenCalled();
  });

  it("settles an old session without clearing or displaying the new session's recovery state", async () => {
    let release!: (value: BrowserActionOutcome) => void;
    const adapter = {
      identity: { userId: "user", organizationId: "org" },
      canWrite: async () => true,
      navigation: {
        push: vi.fn(),
        allowedPath: () => true,
        mayLeave: () => true,
      },
    };
    const { browser, submit, work, host } = setup({ adapter: () => adapter });
    work.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = submit();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    sessionStorage.setItem(
      "copilotkit:autopilot:unsettled:org:other",
      "pending",
    );
    adapter.identity.userId = "other";
    browser.cancel();
    browser.restore();
    vi.mocked(host.notice).mockClear();
    release({ status: "completed", recordId: "one", version: 2 });
    expect(await pending).toMatchObject({ status: "completed" });
    expect(
      sessionStorage.getItem("copilotkit:autopilot:unsettled:org:other"),
    ).toBe("pending");
    expect(
      sessionStorage.getItem("copilotkit:autopilot:unsettled:org:user"),
    ).toBeNull();
    expect(host.notice).not.toHaveBeenCalled();
  });
});
