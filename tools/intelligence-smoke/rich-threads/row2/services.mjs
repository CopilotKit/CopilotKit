import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { relative, isAbsolute } from "node:path";
import { artifactWriter, categories } from "../contract.mjs";
import { createNativeReader } from "./showcase-store.mjs";
import { frameworkSource } from "./framework-source.mjs";
import { inventoryObservations } from "./showcase-content.mjs";
import {
  frontendToolObservations,
  nativeInterruptObservations,
  strandsEnvelopes,
} from "./tool-controls.mjs";

function witnesses(source, scenario) {
  const result = [];
  for (const [index, message] of source.messages.entries()) {
    const add = (category) =>
      result.push({ category, pointer: `/messages/${index}` });
    if (
      typeof message.content === "string" &&
      message.content &&
      message.role !== "tool"
    )
      add(message.role === "reasoning" ? "reasoning" : `${message.role}-text`);
    if (Array.isArray(message.content))
      for (const part of message.content) {
        if (part.type === "text") add(`${message.role}-text`);
        else if (part.source) add(`${part.type}:${part.source.type}`);
      }
    for (const call of message.toolCalls ?? [])
      for (const category of scenario.toolCategories?.[call.function.name] ??
        [])
        add(category);
  }
  return result.filter(
    (item, index) =>
      categories.includes(item.category) &&
      result.findIndex((other) => other.category === item.category) === index,
  );
}

/** Concrete row service: drive the shared browser, then read original files/DBs.
 * Provisioning, application launch, capture hooks and cleanup have ONE owner in
 * the common bootstrap/lifecycle. This module never starts a substitute agent.
 */
export async function createServices({
  framework,
  scope,
  environment,
  browser,
  capture,
  outputDir,
  signal,
}) {
  assert.ok(
    scope.owner && environment.receipt?.cleanScope?.status === "passed",
    "Verified lifecycle clean-scope receipt required",
  );
  assert.equal(
    scope.owner,
    environment.receipt.owner,
    "Native scope must belong to lifecycle owner",
  );
  assert.ok(
    Array.isArray(scope.scenarios) && scope.scenarios.length,
    "Shared Showcase scenario descriptors required",
  );
  for (const method of ["newThread", "send", "upload", "interact", "snapshot"])
    assert.equal(
      typeof browser[method],
      "function",
      `Shared browser.${method} required`,
    );
  assert.equal(
    typeof capture.read,
    "function",
    "Framework-boundary capture reader required",
  );
  const fixture = { row2: { coverage: {} } };
  for (const scenario of scope.scenarios) {
    assert.ok(
      scenario.id && scenario.categories?.length && scenario.steps?.length,
      "Complete Showcase scenario required",
    );
    for (const category of scenario.categories) {
      assert.ok(
        categories.includes(category),
        `Unknown native scenario category ${category}`,
      );
      fixture.row2.coverage[category] ??= { required: [] };
      fixture.row2.coverage[category].required.push(
        `${scenario.id}-${category}`,
      );
    }
  }
  const write = artifactWriter(outputDir);
  return {
    fixture,
    services: {
      row2: {
        async captureFresh() {
          const captures = [];
          await write(
            "native-clean-scope.json",
            environment.receipt.cleanScope,
          );
          for (const scenario of scope.scenarios) {
            signal?.throwIfAborted();
            const native = { ...scope.native, ...scenario.native };
            for (const location of [
              native.location,
              native.workflowLocation,
            ].filter(Boolean)) {
              assert.ok(
                environment.receipt.resources.some(
                  (resource) =>
                    resource.framework === framework &&
                    resource.role === "native-backend" &&
                    resource.stores.some((root) => {
                      const path = relative(root, location);
                      return !path.startsWith("..") && !isAbsolute(path);
                    }),
                ),
                "Native location must be a lifecycle-owned backend store",
              );
            }
            const read = createNativeReader(framework, native);
            let identity;
            let before;
            const thread = await browser.newThread({
              scenarioId: scenario.id,
              mode: scenario.mode,
              beforeRun: async (input) => {
                if (before) return;
                identity = {
                  threadId: input.threadId,
                  resourceId: native.resourceId ?? scope.userId,
                  userId: scope.userId,
                  agentId: scope.agentId,
                  runIds: [input.runId],
                };
                before = await read(identity);
                await write(`${scenario.id}-native-before.json`, before);
              },
            });
            for (const step of scenario.steps) {
              signal?.throwIfAborted();
              if (step.kind === "send") await browser.send(thread, step.prompt);
              else if (step.kind === "upload")
                await browser.upload(thread, step.files);
              else if (step.kind === "interact")
                await browser.interact(thread, step.action);
              else throw new Error(`Unsupported browser action ${step.kind}`);
            }
            assert.ok(
              before && identity,
              "Shared browser did not await native beforeRun capture",
            );
            const boundary = await capture.read(thread.threadId);
            await write(`${scenario.id}-framework-boundary.json`, boundary);
            const source = frameworkSource(boundary.frameworkRuns);
            assert.equal(
              source.threadId,
              thread.threadId,
              "Browser/framework identity changed",
            );
            identity.runIds = [
              ...new Set([
                ...source.runIds,
                ...source.events.flatMap((event) =>
                  (event.outcome?.interrupts ?? [])
                    .map((interrupt) => interrupt.metadata?.mastra?.runId)
                    .filter(Boolean),
                ),
              ]),
            ];
            const after = await read(identity);
            const visible = await browser.snapshot(thread);
            await write(`${scenario.id}-browser.json`, visible);
            await write(`${scenario.id}-native-after.json`, after);
            const inspection = inventoryObservations({
              framework,
              snapshot: after,
              messages: source.messages,
              scenarioId: scenario.id,
              witnesses: witnesses(source, scenario),
            });
            const observations = inspection.observations;
            for (const category of scenario.categories.filter((value) =>
              value.startsWith("shared-state-"),
            )) {
              const state =
                category === "shared-state-read"
                  ? source.inputs.at(-1)?.state
                  : source.state;
              const initial = source.inputs[0]?.state;
              // Default/unchanged state is not a shared-state exercise.
              if (
                !state ||
                !Object.keys(state).length ||
                isDeepStrictEqual(state, initial)
              )
                continue;
              const stateChecks = inventoryObservations({
                framework,
                snapshot: after,
                messages: source.messages,
                scenarioId: scenario.id,
                state,
                stateCategory: category,
              }).observations.filter((item) => item.category === category);
              if (category === "shared-state-read")
                for (const check of stateChecks)
                  check.source.pointer = check.source.pointer.replace(
                    "/state/",
                    `/inputs/${source.inputs.length - 1}/state/`,
                  );
              observations.push(...stateChecks);
              fixture.row2.coverage[category].required = fixture.row2.coverage[
                category
              ].required.filter(
                (name) => name !== `${scenario.id}-${category}`,
              );
              fixture.row2.coverage[category].required.push(
                ...stateChecks.map((item) => item.name),
              );
            }
            if (scenario.control) {
              const category = `${scenario.control.kind}-${scenario.control.status}`;
              const emittedCall = source.messages
                .flatMap((message) => message.toolCalls ?? [])
                .find(
                  (call) => call.function.name === scenario.control.toolName,
                );
              const interrupt = source.events.find(
                (event) =>
                  event.type === "RUN_FINISHED" &&
                  event.outcome?.type === "interrupt",
              );
              const nativeCall = interrupt?.outcome.interrupts[0];
              if (
                scenario.control.kind === "native" &&
                framework === "mastra"
              ) {
                const expectedType =
                  scenario.control.mechanism === "requireApproval"
                    ? "mastra_tool_approval"
                    : "mastra_suspend";
                assert.equal(
                  nativeCall?.metadata?.mastra?.type,
                  expectedType,
                  "Scenario did not exercise the requested Mastra native mechanism",
                );
              }
              const callId = emittedCall?.id ?? nativeCall?.toolCallId;
              assert.ok(
                callId,
                "Control scenario did not emit its requested call identity",
              );
              const result = source.messages.find(
                (message) =>
                  message.role === "tool" && message.toolCallId === callId,
              );
              if (scenario.control.status === "completed")
                assert.ok(
                  result,
                  "Completed control has no source tool result",
                );
              if (scenario.control.status === "completed") {
                const terminal = source.events.findLast((event) =>
                  ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
                );
                assert.ok(
                  terminal?.type === "RUN_FINISHED" &&
                    terminal.outcome?.type !== "interrupt",
                  "Completed control must finish without another pending interrupt",
                );
                assert.ok(
                  source.messages
                    .slice(source.messages.indexOf(result) + 1)
                    .some(
                      (message) =>
                        message.role === "assistant" &&
                        typeof message.content === "string" &&
                        message.content.trim(),
                    ),
                  "Completed control lacks final framework assistant response",
                );
              }
              const envelopes =
                framework === "mastra"
                  ? (after.records.messages ?? []).map((value, index) => ({
                      value,
                      record: "messages",
                      pointer: `/${index}`,
                    }))
                  : strandsEnvelopes(after);
              observations.push(
                ...frontendToolObservations({
                  framework,
                  envelopes,
                  category,
                  callId,
                  name: scenario.control.toolName,
                  args: emittedCall
                    ? JSON.parse(emittedCall.function.arguments)
                    : nativeCall.metadata.mastra.args,
                  result: result?.content,
                  eventsFile: `${scenario.id}-framework-boundary.json`,
                }).map((observation) => ({
                  ...observation,
                  name: `${scenario.id}-${observation.name}`,
                })),
              );
              if (scenario.control.kind === "native")
                observations.push(
                  ...nativeInterruptObservations({
                    framework,
                    snapshot: after,
                    events: source.events,
                    category,
                  }).map((observation) => ({
                    ...observation,
                    name: `${scenario.id}-${observation.name}`,
                  })),
                );
              // Coverage requires every actual control check, never merely the presence
              // of a RUN_FINISHED event or a visible approval button.
              fixture.row2.coverage[category].required = fixture.row2.coverage[
                category
              ].required.filter(
                (name) => name !== `${scenario.id}-${category}`,
              );
              fixture.row2.coverage[category].required.push(
                ...observations
                  .filter((item) => item.category === category)
                  .map((item) => item.name),
              );
            }
            for (const observation of observations) {
              observation.source.artifact = `${scenario.id}-source.json`;
              if (observation.category.startsWith("frontend-"))
                observation.source.pointer = "/messages";
              if (observation.category.startsWith("native-"))
                observation.source.pointer = "/events";
            }
            await write(`${scenario.id}-source.json`, source);
            await write(`${scenario.id}-inspection.json`, inspection);
            captures.push({
              identity,
              before,
              after: {
                ...after,
                records: {
                  ...after.records,
                  inspection: inspection.projection,
                },
              },
              observations,
              freshness: {
                cleanScope: environment.receipt.cleanScope,
                evidence: "native-clean-scope.json",
              },
              provenance: {
                input: `${scenario.id}-framework-boundary.json`,
                events: `${scenario.id}-framework-boundary.json`,
                fixture: "committed-showcase-browser",
                referencePreviouslySeen: true,
              },
              browser: visible,
            });
          }
          return captures;
        },
      },
    },
  };
}
