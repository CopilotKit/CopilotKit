import { inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
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
