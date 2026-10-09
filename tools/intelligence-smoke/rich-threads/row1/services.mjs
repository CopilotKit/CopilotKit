import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { scenarios } from "../scenarios/row1.mjs";
import { projectEvents } from "../capture/project.mjs";
import { artifactWriter } from "../contract.mjs";

export function witnesses(emitted) {
  const found = [];
  const add = (category, pointer) => found.push({ category, pointer });
  emitted.messages.forEach((message, i) => {
    if (
      ["user", "assistant"].includes(message.role) &&
      typeof message.content === "string" &&
      message.content
    )
      add(`${message.role}-text`, `/messages/${i}/content`);
  });
  const surfaces = new Set();
  emitted.events.forEach((event, i) => {
    const pointer = `/events/${i}`;
    if (event.type.startsWith("REASONING_") && (event.delta || event.content))
      add("reasoning", pointer);
    if (event.type === "TOOL_CALL_START") {
      const category = {
        pieChart: "chart-pie",
        barChart: "chart-bar",
        query_data: "ordinary-tool",
        generateSandboxedUi: "calculator-iframe",
      }[event.toolCallName];
      if (category) add(category, pointer);
      if (event.toolCallName?.includes("beautiful_chat_mcp"))
        add("mcp-tool", pointer);
    }
    if (
      event.type === "STATE_SNAPSHOT" &&
      Object.keys(event.snapshot ?? {}).length
    )
      add("shared-state-write", pointer);
    if (event.type === "STATE_DELTA" && event.delta?.length)
      add("shared-state-write", pointer);
    if (
      event.type === "RUN_STARTED" &&
      i > 0 &&
      Object.keys(event.input?.state ?? {}).length
    )
      add("shared-state-read", `${pointer}/input/state`);
    if (event.type === "RUN_ERROR") add("run-error", pointer);
    if (
      event.type === "ACTIVITY_SNAPSHOT" &&
      event.activityType === "mcp-apps" &&
      event.content
    )
      add("mcp-app", pointer);
    if (event.type === "CUSTOM") {
      const payload = JSON.stringify(event.value);
      if (/a2ui/i.test(event.name)) {
        if (/FlightCard|FlightSearch/.test(payload))
          add("flight-card", pointer);
        if (/Dashboard|dashboard/.test(payload)) add("dashboard-a2ui", pointer);
        for (const match of payload.matchAll(/"surfaceId":"([^"]+)"/g))
          surfaces.add(match[1]);
        if (surfaces.size >= 2) add("parallel-surfaces", pointer);
      }
      if (/mcp/i.test(event.name) && /ui:\/\//.test(payload))
        add("mcp-app", pointer);
    }
  });
  return found;
}

export async function createServices({
  framework,
  scope,
  browser,
  intelligence,
  capture,
  signal,
  dependencies,
  outputDir,
}) {
  const write = artifactWriter(outputDir);
  const project = (events) => projectEvents({ events, ...dependencies });
  const inventory =
    scope.scenarios ?? scenarios({ framework, media: scope.media });
  async function runFresh(scenario, { beforeFrameworkRun } = {}) {
    const thread = await browser.newThread({
      scenarioId: scenario.id,
      mode: scenario.mode,
      beforeRun: beforeFrameworkRun,
    });
    try {
      for (const step of scenario.steps) {
        signal?.throwIfAborted();
        if (step.kind === "send") await browser.send(thread, step.prompt);
        else if (step.kind === "upload")
          await browser.upload(thread, step.files);
        else if (step.kind === "interact")
          await browser.interact(thread, {
            ...step.action,
            category:
              step.action.category ??
              (scenario.control
                ? `${scenario.control.kind}-${scenario.control.status}`
                : undefined),
          });
        else throw new Error(`Unknown browser step ${step.kind}`);
      }
      if (scenario.visible) {
        const root = scenario.visible.frame
          ? thread.page.frameLocator(scenario.visible.frame)
          : thread.page;
        await root
          .getByText(scenario.visible.text, { exact: true })
          .waitFor({ state: "visible" });
      }
      const source = await capture.read(thread.threadId);
      await write(`${scenario.id}/source.json`, source);
      const emitted = {
        threadId: thread.threadId,
        agentId: scope.agentId,
        userId: scope.userId,
        runIds: [...new Set(source.events.map((event) => event.runId))],
        events: source.events,
        ...(await project(source.events)),
      };
      const observed = await browser.snapshot(thread);
      const found = witnesses(emitted);
      const media = [];
      for (const file of scenario.media ?? []) {
        const original = await readFile(file.path);
        emitted.messages.forEach((message, i) => {
          if (!Array.isArray(message.content)) return;
          message.content.forEach((part, j) => {
            if (
              part.type === file.type &&
              part.metadata?.filename === basename(file.path)
            )
              media.push({
                pointer: `/messages/${i}/content/${j}`,
                type: file.type,
                sourceType: file.sourceType,
                filename: basename(file.path),
                mimeType: file.mimeType,
                sha256: createHash("sha256").update(original).digest("hex"),
              });
          });
        });
      }
      for (const [index, event] of emitted.events.entries()) {
        if (event.type !== "TOOL_CALL_START") continue;
        const category =
          event.toolCallName === "scheduleTime"
            ? "frontend-completed"
            : event.toolCallName === "generateSandboxedUi"
              ? "calculator-iframe"
              : null;
        const action = observed.interactions.find(
          (item) => item.category === category,
        );
        if (
          event.toolCallName === "scheduleTime" &&
          !action &&
          !emitted.messages.some(
            (message) => message.toolCallId === event.toolCallId,
          )
        )
          found.push({
            category: "frontend-pending",
            pointer: `/events/${index}`,
          });
        if (!action) continue;
        Object.assign(action, {
          controlId: event.toolCallId,
          action: `Clicked ${action.name}`,
          identityPointer: `/events/${index}/toolCallId`,
        });
        if (category === "frontend-completed") {
          const result = emitted.messages.findIndex(
            (message) =>
              message.role === "tool" &&
              message.toolCallId === event.toolCallId,
          );
          const response = emitted.messages.findIndex(
            (message, i) =>
              i > result && message.role === "assistant" && message.content,
          );
          if (result >= 0 && response > result) {
            Object.assign(action, {
              toolCallId: event.toolCallId,
              callIdPointer: `/events/${index}/toolCallId`,
              resultPointer: `/messages/${result}`,
              responsePointer: `/messages/${response}`,
            });
            found.push({ category, pointer: `/messages/${result}` });
          }
        }
      }
      if (emitted.pending.length)
        found.push({ category: "native-pending", pointer: "/pending/0" });
      const nativeAction = observed.interactions.find(
        (item) => item.category === "native-completed",
      );
      if (nativeAction?.controlId) {
        for (const [i, event] of emitted.events.entries()) {
          const interrupts = event.outcome?.interrupts ?? event.interrupts;
          const index = interrupts?.findIndex(
            (item) => item.id === nativeAction.controlId,
          );
          if (index >= 0)
            nativeAction.identityPointer = `/events/${i}/${event.outcome?.interrupts ? "outcome/interrupts" : "interrupts"}/${index}/id`;
          for (const [j, resume] of (event.input?.resume ?? []).entries()) {
            if (resume.interruptId !== nativeAction.controlId) continue;
            nativeAction.resumePointer = `/events/${i}/input/resume/${j}`;
            const responseEvent = emitted.events
              .slice(i + 1)
              .find(
                (item) =>
                  item.runId === event.runId &&
                  item.type === "TEXT_MESSAGE_START" &&
                  item.role === "assistant",
              );
            const responseIndex = emitted.messages.findIndex(
              (message) =>
                message.id === responseEvent?.messageId && message.content,
            );
            if (responseIndex >= 0)
              nativeAction.responsePointer = `/messages/${responseIndex}`;
          }
        }
        if (
          nativeAction.identityPointer &&
          nativeAction.resumePointer &&
          nativeAction.responsePointer
        ) {
          nativeAction.action = `Clicked ${nativeAction.name}`;
          found.push({
            category: "native-completed",
            pointer: nativeAction.resumePointer,
          });
        }
      }
      return {
        emitted,
        browser: observed,
        witnesses: found,
        media,
        frameworkRuns: source.frameworkRuns,
      };
    } catch (error) {
      const failure = { error: String(error) };
      try {
        failure.source = thread.threadId
          ? await capture.read(thread.threadId)
          : null;
      } catch (captureError) {
        failure.captureError = String(captureError);
      }
      try {
        failure.browser = await browser.snapshot(thread);
      } catch (browserError) {
        failure.browserError = String(browserError);
      }
      const evidence = await write(`${scenario.id}/failure.json`, failure);
      throw Object.assign(new Error(String(error), { cause: error }), {
        evidence: [evidence],
      });
    } finally {
      await browser.closeThread(thread);
    }
  }
  async function readSaved(emitted) {
    const deadline = Date.now() + 30_000;
    let saved;
    do {
      signal?.throwIfAborted();
      if (await intelligence.exists(emitted.threadId)) {
        saved = await intelligence.read(emitted.threadId);
        const ids = new Set(
          saved.events.map((event) => event.metadata.cpki_event_id),
        );
        if (
          emitted.events.every((event) => ids.has(event.metadata.cpki_event_id))
        )
          break;
      }
      await delay(250, undefined, { signal });
    } while (Date.now() < deadline);
    assert.ok(saved, "Thread did not become durable within 30s");
    const projection = await project(saved.events);
    // Public API messages remain independent of the raw-event consumer.
    return { ...saved, state: projection.state, pending: projection.pending };
  }
  return {
    fixture: { row1: { scenarios: inventory } },
    services: { row1: { runFresh, readSaved } },
  };
}
