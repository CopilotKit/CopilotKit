import { beforeEach, describe, expect, it } from "vitest";
import {
  execAgent,
  renderMetricBlockTool,
  publishBoardPackTool,
  fileVarianceNarrativeTool,
} from "@/skins/exec/agent";
import * as store from "@/skins/exec/data/store";
import {
  A2UI_OPERATIONS_KEY,
  BLOCK_SURFACE_PREFIX,
  extractSurfaceId,
} from "@/skins/exec/blocks/build-block-ops";

/**
 * THE TWO THINGS `agent.ts` HAS TO GET RIGHT ON ITS OWN, NOT BY INHERITING
 * FROM `buildBlockOps`/`store.publishPack` (which already have their own
 * tests): the SHAPE it hands back across the tool boundary.
 *
 * `render_metric_block` is the ONLY tool that puts a chat-composed block on
 * screen — an agent that calls it and gets ops keyed wrong, or a surface id
 * that is not a BLOCK id, is indistinguishable on stage from a model that
 * declined to render anything. And a block the tool forgot to register as a
 * draft (`store.createDraftBlock`) is a block "Add to dashboard" can never
 * find, which fails silently a step later, on a different screen.
 *
 * `publish_board_pack` is the beat-6 gate. It is EXPORTED BUT NOT REGISTERED
 * (see its doc comment in `agent.ts`) — the countersign card is the agent's
 * only publish path — so this suite is the only caller of its `execute`, and
 * that is exactly what it is for: the refusal shape has to read back
 * `UNEXPLAINED_VARIANCE` and its `breaches` VERBATIM, because the whole
 * teach arc (offerWorkflowRecording → awaitDemonstration →
 * saveLearnedProcedure) only fires if the agent actually sees the refusal
 * rather than a swallowed or reshaped error.
 *
 * Written against keel's `agent.test.ts` pattern of importing `defineTool`
 * consts directly and invoking `.execute` — but importing the tool consts
 * themselves (per the plan's Task 8 note), not extracting them from the
 * agent factory's `config.tools`, since this suite exists to pin the
 * export surface `agent.ts` has not been written yet.
 */

beforeEach(() => store.reset());

describe("render_metric_block", () => {
  it("emits a2ui ops on a block: surface, files a draft, and grows NO dashboard", async () => {
    const before = {
      ceo: store.snapshot().dashboards.ceo.blocks.length,
      cfo: store.snapshot().dashboards.cfo.blocks.length,
    };

    const result = (await renderMetricBlockTool.execute!({
      kind: "metricTile",
      title: "Revenue vs Plan",
      metricId: "revenue",
      department: "all",
      compare: "plan",
    })) as Record<string, unknown>;

    const ops = result[A2UI_OPERATIONS_KEY] as
      | Record<string, unknown>[]
      | undefined;
    expect(
      ops,
      `expected the tool to key its result "${A2UI_OPERATIONS_KEY}"`,
    ).toBeDefined();

    const surfaceId = extractSurfaceId(ops!) ?? "";
    expect(surfaceId.startsWith(BLOCK_SURFACE_PREFIX)).toBe(true);

    // NO dashboard grew — a rendered block is a draft, not a pin.
    const after = store.snapshot().dashboards;
    expect(after.ceo.blocks.length).toBe(before.ceo);
    expect(after.cfo.blocks.length).toBe(before.cfo);

    // A matching draft exists: `addBlockToDashboard` only succeeds against a
    // real draft id (it throws NOT_FOUND otherwise) — that success IS the
    // proof, since the store keeps no other way to read the drafts map.
    const blockId = surfaceId.slice(BLOCK_SURFACE_PREFIX.length);
    const pinned = store.addBlockToDashboard("cfo", blockId);
    expect(pinned.id).toBe(blockId);
    expect(pinned.spec.metricId).toBe("revenue");
  });

  /**
   * The pin handle. `pinBlockToDashboard` (`./tools.tsx`) is the agent's route
   * to the same write "Add to dashboard" performs, and the ONLY id it accepts
   * is the one this result carries — an agent that cannot read a `blockId` off
   * the render result cannot execute beat 5's step 4 at all, and would have to
   * guess an id `addBlockToDashboard` throws NOT_FOUND on.
   */
  it("returns a blockId that store.addBlockToDashboard accepts", async () => {
    const result = (await renderMetricBlockTool.execute!({
      kind: "trendLine",
      title: "Burn rate trend",
      metricId: "burnRate",
      department: "all",
      months: 12,
    })) as Record<string, unknown>;

    const blockId = result.blockId;
    expect(typeof blockId, "the pin needs a string blockId").toBe("string");

    // The surface id and the pin handle are the SAME block — two ids here
    // would pin something other than what the transcript is showing.
    const ops = result[A2UI_OPERATIONS_KEY] as Record<string, unknown>[];
    expect(extractSurfaceId(ops)).toBe(`${BLOCK_SURFACE_PREFIX}${blockId}`);

    const pinned = store.addBlockToDashboard("ceo", blockId as string);
    expect(pinned.id).toBe(blockId);
    expect(store.snapshot().dashboards.ceo.blocks.map((b) => b.id)).toContain(
      blockId,
    );
  });

  /**
   * THE HANG. `metricId` is required for the three metric-bound kinds, and
   * that requirement used to live in the parameter schema as a
   * `.superRefine()`. A zod failure at the parameter boundary NEVER reaches
   * `execute`: the AI SDK emits a `tool-error` stream part, and
   * `@copilotkit/runtime`'s event translation has no arm for one, so no
   * TOOL_CALL_RESULT is emitted and the transcript's chip spins InProgress
   * forever — with no block and nothing said, for a mistake one retry would
   * have fixed.
   *
   * These two tests exercise the guard THROUGH `execute`, which is the only
   * place it can produce a result the model can read and act on. They are
   * also why the guard cannot go back into the schema: invoked directly, as
   * every test in this file invokes it, a schema refinement is not run at
   * all, so these assertions fail outright rather than passing by accident.
   */
  it.each(["metricTile", "trendLine", "varianceBar"] as const)(
    "refuses a %s with no metricId as a READABLE RESULT, never a validation throw",
    async (kind) => {
      const result = (await renderMetricBlockTool.execute!({
        kind,
        title: "Missing its metric",
      })) as Record<string, unknown>;

      expect(
        result.error,
        "the refusal has to arrive as a tool RESULT the model can read; a zod/throw refusal never reaches the client at all",
      ).toBe("METRIC_ID_REQUIRED");

      // It must name the problem AND the way out, or the model retries the
      // identical call.
      expect(String(result.message)).toContain("metricId");
      expect(String(result.message)).toContain(kind);

      // And it rendered NOTHING: no ops to draw an empty block from, and no
      // blockId that would let a later `pinBlockToDashboard` pin a tile bound
      // to no metric.
      expect(result[A2UI_OPERATIONS_KEY]).toBeUndefined();
      expect(result.blockId).toBeUndefined();
    },
  );

  it("still renders the two self-binding kinds with no metricId", async () => {
    // The guard must be scoped to the metric-bound kinds only — an
    // exceptionList carries its own rows, and refusing it would break beat 6's
    // "what needs explaining" block.
    const result = (await renderMetricBlockTool.execute!({
      kind: "exceptionList",
      title: "Open exceptions",
    })) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result[A2UI_OPERATIONS_KEY]).toBeDefined();
    expect(typeof result.blockId).toBe("string");
  });
});

/**
 * THE ONE-STEP RUN. `@copilotkit/runtime` forwards `maxSteps` into
 * `streamText` as `stopWhen: config.maxSteps ? stepCountIs(config.maxSteps) :
 * undefined`, and the AI SDK's own default is `stopWhen = stepCountIs(1)`.
 * With `maxSteps` unset the run therefore ENDS the moment a backend tool
 * returns — no follow-up model turn, so `get_metrics` never becomes a
 * sentence, `render_metric_block` never gets the prose EXEC_PROMPT rule 2
 * requires, and neither beat 5's render→pin procedure nor beat 6's
 * read→file→re-publish arc can chain. Nothing else in the stack papers over
 * it: `CopilotKitCore` starts a follow-up run only when a FRONTEND tool
 * executed.
 *
 * Read through the same `as unknown as { config }` cast keel's
 * `agent.test.ts` uses (`config` is `private` to TypeScript and present at
 * runtime) so this pins the value actually handed to `BuiltInAgent`, not a
 * copy of it.
 */
describe("execAgent configuration", () => {
  const config = () =>
    (execAgent() as unknown as { config: Record<string, unknown> }).config;

  it("sets maxSteps so a backend tool call is not the end of the run", () => {
    expect(
      config().maxSteps,
      "unset means stopWhen: stepCountIs(1) — the run ends on the first tool result",
    ).toBe(12);
  });

  it("registers exactly the four tools EXEC_PROMPT advertises", () => {
    // `publish_board_pack` must stay OUT: the countersign card is the agent's
    // only publish path (see that tool's doc comment in `agent.ts`).
    const names = (config().tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual([
      "get_metrics",
      "list_exceptions",
      "render_metric_block",
      "file_variance_narrative",
    ]);
  });

  /**
   * EXPORTED BUT NOT REGISTERED — both halves, stated as one assertion.
   *
   * The roster above pins the four names, but nothing pinned the pair of
   * facts `publish_board_pack` actually turns on: it exists under exactly that
   * name (the suite below calls its `execute` as the only caller there is, and
   * the countersign card in `tools.tsx` reaches it by name), AND it is absent
   * from what the model can call. Registering it would hand the agent a
   * publish path around the countersign card; renaming or dropping the export
   * would silently leave the card with nothing to call.
   */
  it("exports publish_board_pack without registering it for the model", () => {
    expect(publishBoardPackTool.name).toBe("publish_board_pack");
    expect(typeof publishBoardPackTool.execute).toBe("function");

    const names = (config().tools as { name: string }[]).map((t) => t.name);
    expect(
      names,
      "the countersign card is the only publish path — a registered publish tool routes around it",
    ).not.toContain(publishBoardPackTool.name);
  });
});

/**
 * BEAT 6's WITHHELD VOCABULARY, as an invariant rather than a comment.
 *
 * The publish gate is cleared by FILING a narrative, so an agent that can read
 * a valid code off any agent-facing string clears the gate unaided and the
 * teach arc silently stops existing. The prompt and every registered tool
 * description are agent-facing, so none of them may name a code — and the
 * `code` parameter must stay a free string rather than an enum, which would
 * publish the whole catalogue into the tool's JSON schema.
 */
describe("exec agent-facing text", () => {
  const surfaces = () => {
    const config = (
      execAgent() as unknown as {
        config: { prompt: string; tools: { description: string }[] };
      }
    ).config;
    return [config.prompt, ...config.tools.map((t) => t.description)];
  };

  it("names no narrative code anywhere the model can read", () => {
    for (const text of surfaces()) {
      expect(
        text,
        `leaked a narrative code: ${text.slice(0, 60)}…`,
      ).not.toMatch(/VAR-/);
    }
  });

  it("tells the model to SAY a lever is unset rather than omit it", () => {
    // navigateTo's levers are all REQUIRED with explicit sentinels
    // ("any"/0/false — see `tools.tsx`). The prompt used to tell the model to
    // "leave the others unset", which the schema does not allow: told to omit
    // an enum it cannot omit, gpt-5.4 fills it and puts an empty board on
    // screen under four confidently tinted controls.
    const prompt = surfaces()[0];
    expect(prompt).not.toMatch(/leave the others unset/i);
    expect(prompt).toMatch(/"any"/);
  });

  it("tells the model to render blocks one at a time", () => {
    // Two `render_metric_block` calls in one step collide on a single a2ui
    // surface and the second replaces the first (upstream
    // @ag-ui/a2ui-middleware key collision on parallel tool calls), so the
    // prompt has to forbid the batch.
    expect(surfaces()[0]).toMatch(/ONE BLOCK AT A TIME/);
  });
});

/**
 * `file_variance_narrative` calls `store.fileNarrative` DIRECTLY (see
 * `agent.ts`'s doc comment above `PERIOD_RE`) — it never goes through the
 * REST route (`src/app/api/exec/v1/narratives/route.ts`), so that route's
 * zod validation buys this tool nothing. It needs, and has, its own guards
 * for the same two silent-demo-killers: a mistyped period that files a
 * narrative matching no breach, and an empty body that flips `explained` on
 * nothing. Both refusals must stay CODE-FREE, same as `BAD_CODE` above.
 */
describe("file_variance_narrative", () => {
  const VALID_ARGS = {
    metricId: "opex" as const,
    period: "2024-06",
    code: "VAR-TIMING",
    body: "Shipment timing shift pushed the spend into this period.",
  };

  const WITHHELD_CODES = ["VAR-TIMING", "VAR-ONEOFF", "VAR-FX", "VAR-PLAN"];

  it("refuses a malformed period and names no code — the store gains no narrative", async () => {
    const before = store.snapshot().narratives.length;
    const result = (await fileVarianceNarrativeTool.execute!({
      ...VALID_ARGS,
      period: "2024-6",
    })) as Record<string, unknown>;

    expect(result.error).toBe("BAD_PERIOD");
    const text = JSON.stringify(result);
    for (const code of WITHHELD_CODES) {
      expect(text).not.toContain(code);
    }
    expect(store.snapshot().narratives.length).toBe(before);
  });

  it("refuses a whitespace-only body and names no code — the store gains no narrative", async () => {
    const before = store.snapshot().narratives.length;
    const result = (await fileVarianceNarrativeTool.execute!({
      ...VALID_ARGS,
      body: "   ",
    })) as Record<string, unknown>;

    expect(result.error).toBe("EMPTY_BODY");
    const text = JSON.stringify(result);
    for (const code of WITHHELD_CODES) {
      expect(text).not.toContain(code);
    }
    expect(store.snapshot().narratives.length).toBe(before);
  });

  it("files a valid narrative with the body trimmed", async () => {
    const result = (await fileVarianceNarrativeTool.execute!({
      ...VALID_ARGS,
      body: "  Shipment timing shift.  ",
    })) as Record<string, unknown>;

    const narrative = result.narrative as { body: string } | undefined;
    expect(narrative?.body).toBe("Shipment timing shift.");
  });
});

describe("publish_board_pack", () => {
  it("propagates the seeded CFO dashboard's UNEXPLAINED_VARIANCE gate verbatim", async () => {
    // Independent oracle call, same seed, same (unexplained) PIN-correct
    // path: the store's own gate never mutates state on the 422 branch, so
    // calling it here and again through the tool below both read the same
    // seeded, unexplained opex/distribution breach.
    const gate = store.publishPack("cfo", store.COUNTERSIGN_PIN);
    expect(
      gate.ok,
      "fixture assumption broken: seeded cfo dashboard no longer breaches",
    ).toBe(false);
    if (gate.ok || gate.code !== "UNEXPLAINED_VARIANCE") {
      throw new Error(
        "fixture assumption broken: seeded cfo dashboard no longer breaches UNEXPLAINED_VARIANCE",
      );
    }

    const result = (await publishBoardPackTool.execute!({
      dashboardId: "cfo",
      countersignPin: store.COUNTERSIGN_PIN,
    })) as Record<string, unknown>;

    // VERBATIM: the agent must be able to read the gate back, not a
    // reshaped or summarized version of it.
    expect(result).toEqual({
      error: "UNEXPLAINED_VARIANCE",
      breaches: gate.breaches,
    });

    // And the breach the gate names is the real, unexplained seeded one —
    // not an empty or unrelated decoy array that happened to satisfy toEqual.
    const breaches = result.breaches as
      | { metricId: string; explained: boolean }[]
      | undefined;
    expect(
      breaches?.some((b) => b.metricId === "opex" && b.explained === false),
    ).toBe(true);
  });
});
