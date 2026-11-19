import { inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { CopilotKitCore } from "@copilotkit/core";
import { test, expect, vi } from "vitest";
import { provideCopilotKit } from "./config";
import { CopilotKit } from "./copilotkit";
import {
  CopilotChatConfiguration,
  provideCopilotChatConfiguration,
  injectChatConfiguration,
} from "./chat-configuration";

test("provideCopilotChatConfiguration registers an injectable instance", () => {
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });
  const config = TestBed.runInInjectionContext(() => injectChatConfiguration());
  expect(config).toBeInstanceOf(CopilotChatConfiguration);
});

test("uncontrolled config mints a non-explicit thread by default", () => {
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });
  const c = TestBed.runInInjectionContext(() => injectChatConfiguration());
  expect(c.threadId()).toBeTruthy();
  expect(c.hasExplicitThreadId()).toBe(false);
});

test("a caller threadId is controlled + explicit", () => {
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration({ threadId: "caller-1" })],
  });
  const c = TestBed.runInInjectionContext(() => injectChatConfiguration());
  expect(c.threadId()).toBe("caller-1");
  expect(c.hasExplicitThreadId()).toBe(true);
});

test("a non-explicit seed is used but stays non-explicit", () => {
  TestBed.configureTestingModule({
    providers: [
      provideCopilotChatConfiguration({
        threadId: "seed-1",
        hasExplicitThreadId: false,
      }),
    ],
  });
  const c = TestBed.runInInjectionContext(() => injectChatConfiguration());
  expect(c.threadId()).toBe("seed-1");
  expect(c.hasExplicitThreadId()).toBe(false);
});

test("setActiveThreadId switches to an explicit thread", () => {
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });
  const c = TestBed.runInInjectionContext(() => injectChatConfiguration());
  c.setActiveThreadId("picked-1");
  expect(c.threadId()).toBe("picked-1");
  expect(c.hasExplicitThreadId()).toBe(true);
});

test("startNewThread mints a fresh non-explicit thread", () => {
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });
  const c = TestBed.runInInjectionContext(() => injectChatConfiguration());
  c.setActiveThreadId("picked-1");
  const before = c.threadId();
  c.startNewThread();
  expect(c.threadId()).not.toBe(before);
  expect(c.hasExplicitThreadId()).toBe(false);
});

test("setters no-op when the threadId is controlled", () => {
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration({ threadId: "caller-1" })],
  });
  const c = TestBed.runInInjectionContext(() => injectChatConfiguration());
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  c.setActiveThreadId("ignored");
  expect(c.threadId()).toBe("caller-1");
  // Like React and Vue, the ignored call is reported.
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining("Ignoring setActiveThreadId()"),
  );
  warn.mockRestore();
});

test("registers the shown thread with core and follows thread changes", () => {
  TestBed.configureTestingModule({
    providers: [
      provideCopilotKit({}),
      provideCopilotChatConfiguration({ agentId: "support" }),
    ],
  });
  const core = TestBed.inject(CopilotKit).core;
  const registrations: string[] = [];
  vi.spyOn(core, "registerOpenThread").mockImplementation(
    ({ agentId, threadId }) => {
      registrations.push(`open ${agentId} ${threadId}`);
      return {
        update: (next) => registrations.push(`update ${next}`),
        unregister: () => registrations.push("close"),
      };
    },
  );
  const c = TestBed.runInInjectionContext(() => injectChatConfiguration());
  const minted = c.threadId();

  c.setActiveThreadId("picked");

  expect(registrations).toEqual([`open support ${minted}`, "update picked"]);
});

test("registers a thread shown before CopilotKit is created once it is", () => {
  TestBed.configureTestingModule({
    providers: [
      provideCopilotKit({}),
      provideCopilotChatConfiguration({ agentId: "support" }),
    ],
  });
  const registrations: string[] = [];
  vi.spyOn(CopilotKitCore.prototype, "registerOpenThread").mockImplementation(
    ({ agentId, threadId }) => {
      registrations.push(`open ${agentId} ${threadId}`);
      return { update: () => {}, unregister: () => {} };
    },
  );
  const c = TestBed.runInInjectionContext(() => injectChatConfiguration());
  expect(registrations).toEqual([]);

  TestBed.inject(CopilotKit);

  expect(registrations).toEqual([`open support ${c.threadId()}`]);
});

test("drawer registration toggles drawerRegistered and unregisters", () => {
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });
  const c = TestBed.runInInjectionContext(() => injectChatConfiguration());
  expect(c.drawerRegistered()).toBe(false);
  const unregister = c.registerDrawer();
  expect(c.drawerRegistered()).toBe(true);
  unregister();
  expect(c.drawerRegistered()).toBe(false);
});

test("drawerOpen is settable", () => {
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });
  const c = TestBed.runInInjectionContext(() => injectChatConfiguration());
  expect(c.drawerOpen()).toBe(false);
  c.setDrawerOpen(true);
  expect(c.drawerOpen()).toBe(true);
});

test("token and direct class injection resolve the same instance", () => {
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });
  const [viaToken, viaClass] = TestBed.runInInjectionContext(() => [
    injectChatConfiguration(),
    inject(CopilotChatConfiguration),
  ]);
  expect(viaToken).toBe(viaClass);
});

/** The removal warnings among the calls of a `console.warn` spy. */
function removalWarnings(warn: { mock: { calls: unknown[][] } }) {
  return warn.mock.calls
    .map(([message]) => message)
    .filter(
      (message) =>
        typeof message === "string" &&
        message.includes("was removed in CopilotKit 2.0."),
    );
}

test("_setOverride throws the removal error, which points to setActiveThreadId", () => {
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });
  const c = TestBed.runInInjectionContext(() => injectChatConfiguration());

  // @ts-expect-error -- 2.0 types the 1.x arguments as never
  expect(() => c._setOverride("picked-1", true)).toThrow(
    expect.objectContaining({
      name: "CopilotKitRemovedApiError",
      code: "REMOVED_API",
      message:
        '"_setOverride" of CopilotChatConfiguration was removed in CopilotKit 2.0. Call setActiveThreadId(threadId, { explicit }) instead. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#_setoverride-in-angular',
    }),
  );
});

test("a subclass that overrides _setOverride warns once, in development", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  class LegacyChatConfiguration extends CopilotChatConfiguration {
    // @ts-expect-error -- 2.0 types _setOverride as never, so that the override fails
    override _setOverride(threadId: string) {
      this.setActiveThreadId(threadId);
    }
  }
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });

  TestBed.runInInjectionContext(() => [
    new LegacyChatConfiguration(),
    new LegacyChatConfiguration(),
  ]);

  expect(removalWarnings(warn)).toEqual([
    'An override of "_setOverride" in a subclass of CopilotChatConfiguration was removed in CopilotKit 2.0. 2.0 does not call _setOverride. Move the code into overrides of setActiveThreadId and startNewThread. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#_setoverride-in-angular',
  ]);
  warn.mockRestore();
});

test("the 2.0 chat configuration does not warn about _setOverride", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    providers: [provideCopilotChatConfiguration()],
  });

  const c = TestBed.runInInjectionContext(() => injectChatConfiguration());

  expect(c.threadId()).toBeTruthy();
  expect(removalWarnings(warn)).toEqual([]);
  warn.mockRestore();
});
