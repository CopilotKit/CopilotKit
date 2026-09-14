import { useEffect, useRef } from "react";
import {
  useFrontendTool,
  useRenderTool as useCoreRenderTool,
} from "@copilotkit/react-core/v2/headless";
import type {
  ReactFrontendTool,
  RenderToolProps,
} from "@copilotkit/react-core/v2/headless";
import { ToolCallStatus } from "@copilotkit/core";
import type { FrontendToolHandlerContext } from "@copilotkit/core";
import type { InferSchemaOutput, StandardSchemaV1 } from "@copilotkit/shared";

/**
 * TEMPORARY COMPATIBILITY SHIM — scheduled for removal in the next minor.
 * Removal is tracked in CopilotKit/CopilotKit#6976 (Linear OSS-1148).
 *
 * ─── Why this exists at all ──────────────────────────────────────────────────
 *
 * `@copilotkit/react-native` used to export a hook named `useRenderTool` that
 * was NOT react-core's `useRenderTool`: its whole body forwarded to core's
 * OTHER hook, `useFrontendTool`, while wearing this one's name. The two are not
 * interchangeable — `useFrontendTool` registers a TOOL (advertised to the model,
 * callable by it) *and* its renderer through `addTool`, while `useRenderTool`
 * registers a RENDERER ONLY through `addHookRenderToolCall` and special-cases
 * `name: "*"` into a schema-less fallback. Under the alias, `name: "*"`
 * registered a frontend tool literally named `*`.
 *
 * ─── What a tool named `*` actually does ─────────────────────────────────────
 *
 * NOT "gets advertised to the model": core has never offered it. `*` is core's
 * catch-all HANDLER name, and `buildFrontendTools` filters it out of the list
 * it hands the agent (`core/src/core/run-handler.ts`, at the
 * `tool.name !== WILDCARD_TOOL_NAME` clause) precisely so the model is not
 * offered a tool whose name is a glob.
 *
 * What it does instead is worse for the affected caller. When a tool call has
 * no matching frontend tool and no result yet, core reaches for
 * `getWildcardTool()` and runs `executeWildcardTool`. Inside it, the parse /
 * handler / subscriber work is guarded by `if (wildcardTool?.handler)` — but
 * the tool-result splice and the follow-up return sit OUTSIDE that guard, and
 * `toolCallResult` is initialised to `""`. So a handler-less wildcard tool —
 * exactly what a caller who wanted a display-only fallback wrote — still
 * splices an EMPTY tool result for the call and still asks for another turn.
 *
 * Driving one turn through it (an assistant message calling a tool nobody
 * registered) shows the difference directly: through the old hook, two turns
 * and a spliced `{ toolCallId, content: "" }`; through core's `useRenderTool`,
 * one turn and no tool result. So an RN app whose author wanted a display-only
 * fallback was also auto-answering every otherwise-unanswered tool call with an
 * empty result and paying for a follow-up turn.
 *
 * The scope of that is bounded: it only bites a tool call with no exact-name
 * frontend tool AND no result yet, so a server-side tool call whose result has
 * already arrived never reaches the branch.
 *
 * The convergence deleted RN's hook and re-exported core's two instead. That is
 * a break, and this package ships in the `monorepo` release scope — 16 packages
 * versioned in lockstep — so it lands in a MINOR, not a major. The compiler is
 * therefore the only signal that reaches most consumers, and there are call
 * shapes the compiler cannot see:
 *
 *   • a HOISTED config object whose `render` ignores its props (TypeScript's
 *     excess-property check only fires on a fresh object literal);
 *   • the old fields arriving via a SPREAD into an otherwise fresh literal;
 *   • an UNTYPED or `@ts-nocheck` call site — plain-JS React Native screens are
 *     common.
 *
 * In all three, core's `useRenderTool` would silently ignore `description` and
 * `handler`; and because core's renderer bridge spreads
 * `{ ...props, parameters: props.args }`, an old `render: ({ args }) => …` keeps
 * painting EXACTLY as before. The screen looks unchanged while the tool stops
 * being registered and advertised and the handler never runs again. That is the
 * failure this shim exists to prevent: it routes such calls the way the old hook
 * did, and says so out loud.
 *
 * ─── Warning idiom ───────────────────────────────────────────────────────────
 *
 * `[CopilotKit] `-prefixed `console.warn`, deduped through a module-level `Set`
 * so a render path cannot spam it — the same shape as
 * react-core's `warnedUnknownStatuses` in `use-default-render-tool.tsx`.
 *
 * The dev gate is `process.env.NODE_ENV !== "production"`, which is what
 * react-core's own hooks/components use and what a test can flip. Other RN
 * modules in this package gate on React Native's `__DEV__` global instead; both
 * are compile-time-inlined by Metro, so either is stripped from a release
 * bundle. `NODE_ENV` is chosen here because this module sits between two
 * react-core hooks and is asserted against directly in the suite.
 */

/**
 * The two hooks a call can be routed to. Named for the core hook that ends up
 * owning the registration, because that is the thing a consumer must change
 * their call to.
 */
type Route = "useFrontendTool" | "useRenderTool";

/**
 * Dedup key set for the deprecation warning: one warning per distinct tool
 * name, not one per render. Module-level (not a ref) so remounting the same
 * screen does not re-warn either.
 */
const warnedToolNames = new Set<string>();

/** Tool-shaped fields that only `useFrontendTool` can honour. */
const LEGACY_TOOL_FIELDS = ["description", "handler"] as const;

/**
 * Fields the OLD React Native hook accepted, kept optional here so the call
 * shapes the compiler cannot see (hoisted / spread / untyped) still type-check
 * and get routed rather than silently dropped.
 *
 * @typeParam A - The parsed argument type a legacy `handler` receives.
 */
interface LegacyToolFields<A> {
  /**
   * @deprecated A description is a TOOL field: it is what gets advertised to
   * the model. Supplying it routes this call to `useFrontendTool` — rename the
   * call to `useFrontendTool` instead.
   */
  description?: string;
  /**
   * @deprecated A handler is a TOOL field: it is what the model's call
   * executes. Supplying it routes this call to `useFrontendTool` — rename the
   * call to `useFrontendTool` instead. Note that core's handler receives a
   * SECOND argument (the {@link FrontendToolHandlerContext}, carrying
   * `stopAgent()`'s abort signal), which the old React Native hook dropped.
   */
  handler?: (args: A, context: FrontendToolHandlerContext) => Promise<unknown>;
}

/** The wildcard call shape: a fallback renderer for every unclaimed tool call. */
type WildcardConfig = {
  name: "*";
  render: (props: any) => React.ReactElement | null;
  agentId?: string;
} & LegacyToolFields<Record<string, unknown>> & {
    /**
     * @deprecated A wildcard renderer paints tool calls it does not own, so it
     * has no schema of its own — core's wildcard path ignores this. Remove it.
     */
    parameters?: StandardSchemaV1;
  };

/** The name-scoped call shape. */
type NamedConfig<S extends StandardSchemaV1> = {
  name: string;
  parameters: S;
  render: (props: RenderToolProps<S>) => React.ReactElement | null;
  agentId?: string;
} & LegacyToolFields<InferSchemaOutput<S>>;

/**
 * The IMPLEMENTATION-side shape: the union of both public overloads with
 * everything optional and the schema-dependent positions left as `any`.
 *
 * Deliberately permissive, and invisible to consumers — the two overloads above
 * are the public API. This is the same shape react-core gives its own
 * implementation signatures (`useRenderTool`, `defineToolCallRenderer`), and it
 * is what lets this body forward a config to either core hook without a single
 * cast: the alternative — a generic implementation signature — cannot be
 * satisfied by both a `name: "*"` config with no schema and a named config with
 * one.
 */
type ShimConfig = {
  name: string;
  // `<any, any>` rather than the bare default (`<unknown, unknown>`): a
  // schema's OUTPUT type sits in an invariant position on the Standard Schema
  // interface, so the bare default is not assignable to the
  // `StandardSchemaV1<any, Record<string, unknown>>` that core's
  // `ReactFrontendTool` declares. Bridging that variance here — in the
  // implementation-only shape — is what keeps the body cast-free.
  parameters?: StandardSchemaV1<any, any>;
  render: (props: any) => React.ReactElement | null;
  agentId?: string;
} & LegacyToolFields<any>;

/**
 * Which core hook a config routes to.
 *
 * Rule 1 — `name === "*"` WINS, UNCONDITIONALLY. This is deliberately not the
 * obvious reading of "old fields mean the old hook". The old RN hook made
 * `description` REQUIRED, so anyone who ever attempted a wildcard renderer
 * necessarily wrote it WITH the old tool fields. Routing "has old fields" to
 * `useFrontendTool` would therefore recreate the original `*`-named-tool bug for
 * precisely the people who had tried hardest to use the wildcard. A wildcard
 * always means renderer-only.
 *
 * Rule 2 — otherwise, `handler` or `description` present means the caller wanted
 * a tool AND its renderer, which is what the old hook actually did:
 * `useFrontendTool`.
 *
 * Rule 3 — otherwise, `useRenderTool`, i.e. core's hook, unchanged.
 *
 * One consequence worth knowing about the renderer-only routes (1 and 3): they
 * change the EFFECT PHASE the registration lands in. `useFrontendTool`
 * registers in a `useLayoutEffect`, core's `useRenderTool` in a `useEffect`, so
 * a call that used to register during the layout phase now registers one phase
 * later. Only untyped-JS callers can be affected (a typed old call site had to
 * supply the required `description`, which routes to `useFrontendTool` and
 * keeps the layout phase), and the later phase is what core's `useRenderTool`
 * has always done on the web, so this is documented rather than compensated
 * for.
 */
function routeFor(config: {
  name: string;
  description?: unknown;
  handler?: unknown;
}): Route {
  if (config.name === "*") return "useRenderTool";
  if (config.description !== undefined || config.handler !== undefined) {
    return "useFrontendTool";
  }
  return "useRenderTool";
}

/** Legacy field names actually supplied on this config, in declaration order. */
function legacyFieldsOn(config: ShimConfig): string[] {
  const supplied: string[] = LEGACY_TOOL_FIELDS.filter(
    (field) => config[field] !== undefined,
  );
  // `parameters` is only a legacy field on the wildcard path, where core has no
  // use for it. On the named path it is core's own field and must not be named.
  if (config.name === "*" && config.parameters !== undefined) {
    supplied.push("parameters");
  }
  return supplied;
}

/** `description`, `handler` -> "`description`, `handler`" */
const quoteList = (names: readonly string[]) =>
  names.map((name) => `\`${name}\``).join(", ");

const SHIM_NOTICE =
  "React Native's `useRenderTool` is a temporary compatibility shim " +
  "(deprecated, scheduled for removal in the next minor).";

/**
 * TEST-ONLY escape hatch for the per-name dedup above.
 *
 * Not re-exported from any package entry (`src/headless.ts` exports only the
 * hook), so it is not public API. It exists because the dedup key is the tool
 * NAME and lives for the lifetime of the module: the wildcard's name is the
 * same `"*"` for every caller, so without this the second test to assert the
 * wildcard's warning would silently observe zero calls and have to be written
 * order-dependently instead.
 */
export function __resetRenderToolShimWarnings(): void {
  warnedToolNames.clear();
}

function warnOnce(name: string, message: string): void {
  if (process.env.NODE_ENV === "production") return;
  if (warnedToolNames.has(name)) return;
  warnedToolNames.add(name);
  console.warn(message);
}

/**
 * Says what was received, which hook the call was routed to, and what to change
 * the call to. Dev-only and once per distinct tool name.
 *
 * EVERY route warns — including the renderer-only route that supplied no legacy
 * fields at all. That route looks like a no-op and is not. `description` was
 * REQUIRED on the old hook, so a TypeScript caller could never reach
 * `{ name, parameters, render }` — but an untyped JS caller could, and untyped
 * JS is the whole population this shim exists for. `FrontendTool.handler` is
 * optional (`core/src/types.ts`) and `buildFrontendTools` does not filter on
 * it, so on the old hook that same call DID register AND advertise a real tool.
 * Routing cannot recover the intent, because `{ name, parameters, render }` is
 * equally the correct NEW renderer-only spelling — so the warning has to carry
 * it, or this one shape stays silent while losing registration.
 */
function warnRouted(
  name: string,
  route: Route,
  legacyFields: readonly string[],
): void {
  if (legacyFields.length === 0) {
    // Guarded on the ROUTE, not just on the absence of legacy fields: a config
    // that HAD them on its first render and then dropped them keeps its frozen
    // `useFrontendTool` route, and calling that "renderer only" would be false.
    // That case already warned on the first render (and gets the drift warning
    // besides), so there is nothing to add here.
    if (route !== "useRenderTool") return;

    const registersRendererOnly =
      `[CopilotKit] \`useRenderTool({ name: "${name}" })\` from ` +
      `@copilotkit/react-native registers a RENDERER ONLY: it supplies UI for a ` +
      `tool call and registers no tool of its own. `;

    warnOnce(
      name,
      name === "*"
        ? registersRendererOnly +
            `That is the right behaviour for a wildcard, and it is NOT what the ` +
            `old React Native \`useRenderTool\` did: that registered a tool ` +
            `literally named "*", which is core's catch-all HANDLER name, so it ` +
            `auto-answered every otherwise-unanswered tool call with an empty ` +
            `tool result and asked for a follow-up turn. ${SHIM_NOTICE} Switch ` +
            `to \`useRenderTool\` from \`@copilotkit/react-core\`.`
        : registersRendererOnly +
            `On the old React Native hook this SAME call also registered and ` +
            `advertised a tool named "${name}" to the model, so if you relied on ` +
            `that, this call has quietly stopped doing it — use ` +
            `\`useFrontendTool\` instead. If you only ever wanted to supply UI ` +
            `for a tool somebody else owns, this call is already correct: switch ` +
            `it to \`useRenderTool\` from \`@copilotkit/react-core\`. ` +
            `${SHIM_NOTICE}`,
    );
    return;
  }

  const received =
    `[CopilotKit] \`useRenderTool({ name: "${name}" })\` from ` +
    `@copilotkit/react-native received ${quoteList(legacyFields)}. `;

  if (route === "useFrontendTool") {
    warnOnce(
      name,
      received +
        `Those are TOOL fields, so this call was routed to \`useFrontendTool\` — ` +
        `the hook that registers a tool AND its renderer, which is what the old ` +
        `React Native \`useRenderTool\` did. ${SHIM_NOTICE} Rename the call to ` +
        `\`useFrontendTool\` (same config object; render props rename \`args\` to ` +
        `\`parameters\`). If you only meant to supply UI for a tool somebody else ` +
        `owns, drop ${quoteList(legacyFields)} and keep \`useRenderTool\`.`,
    );
    return;
  }

  // Reached with legacy fields present but the renderer-only route in force.
  // Normally that is the wildcard (rule 1); it is also what a frozen route
  // looks like if a config grew legacy fields after its first render.
  warnOnce(
    name,
    received +
      `This call registers a RENDERER ONLY through react-core's ` +
      `\`useRenderTool\`, which cannot use them, so they were IGNORED. ` +
      (name === "*"
        ? `No tool named "*" is registered — the old React Native ` +
          `\`useRenderTool\` did register one, and that was the bug: "*" is ` +
          `core's catch-all HANDLER name, so it auto-answered every ` +
          `otherwise-unanswered tool call with an empty tool result and asked ` +
          `for a follow-up turn. `
        : `The route was fixed at this component's first render and cannot ` +
          `change for its lifetime. `) +
      `${SHIM_NOTICE} Remove ${quoteList(legacyFields)} from this call. ` +
      `If you meant to register a real frontend tool, give it a real name and ` +
      `use \`useFrontendTool\`.`,
  );
}

/**
 * Registers a wildcard (`"*"`) renderer for tool calls.
 *
 * @deprecated Use `useRenderTool` from `@copilotkit/react-core` (re-exported by
 * `@copilotkit/react-native/headless` once this shim is gone) for a
 * renderer-only registration, or `useFrontendTool` to register a tool and its
 * renderer together. This shim is scheduled for removal in the next minor.
 *
 * @param config - Wildcard renderer configuration.
 * @param deps - Optional dependencies to refresh registration.
 */
export function useRenderTool(
  config: WildcardConfig,
  deps?: ReadonlyArray<unknown>,
): void;

/**
 * Registers a name-scoped renderer for tool calls — or, if `description` or
 * `handler` is supplied, a frontend tool and its renderer (what the old React
 * Native hook did), with a development warning.
 *
 * @deprecated Use `useRenderTool` from `@copilotkit/react-core` (re-exported by
 * `@copilotkit/react-native/headless` once this shim is gone) for a
 * renderer-only registration, or `useFrontendTool` to register a tool and its
 * renderer together. This shim is scheduled for removal in the next minor.
 *
 * @typeParam S - Schema type describing tool call parameters.
 * @param config - Named renderer configuration.
 * @param deps - Optional dependencies to refresh registration.
 */
export function useRenderTool<S extends StandardSchemaV1>(
  config: NamedConfig<S>,
  deps?: ReadonlyArray<unknown>,
): void;

/**
 * @deprecated Temporary compatibility shim over react-core's `useRenderTool` /
 * `useFrontendTool`; scheduled for removal in the next minor. See the routing
 * rules on {@link routeFor}.
 */
export function useRenderTool(
  config: ShimConfig,
  deps?: ReadonlyArray<unknown>,
): void {
  const route = routeFor(config);

  // The route is FROZEN at first render. A hook cannot be called conditionally
  // unless the condition is stable for the component's lifetime, and a config
  // whose shape changes between renders (`handler: enabled ? fn : undefined`)
  // would otherwise flip which core hook is called. Freezing keeps the call
  // order constant; the drift is reported below rather than acted on, because
  // silently re-routing a live registration is the failure mode this whole shim
  // exists to prevent.
  const frozenRouteRef = useRef<Route | null>(null);
  frozenRouteRef.current ??= route;
  const frozenRoute = frozenRouteRef.current;

  const legacyFields = legacyFieldsOn(config);

  useEffect(() => {
    warnRouted(config.name, frozenRoute, legacyFields);
    // The warning is keyed on the tool name, so re-running it for a changed
    // render closure would be pure noise; `warnOnce` dedups anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.name, frozenRoute, legacyFields.join(",")]);

  useEffect(() => {
    if (route === frozenRoute) return;
    warnOnce(
      `${config.name}:route-drift`,
      `[CopilotKit] \`useRenderTool({ name: "${config.name}" })\` from ` +
        `@copilotkit/react-native changed shape between renders: it now routes ` +
        `to \`${route}\` but was registered through \`${frozenRoute}\` and stays ` +
        `there for this component's lifetime (a hook cannot be swapped mid-life). ` +
        `Call \`${route}\` directly instead of varying \`description\`/\`handler\`.`,
    );
  }, [config.name, route, frozenRoute]);

  if (frozenRoute === "useFrontendTool") {
    // Registration is DELEGATED, never reimplemented: this package must own no
    // render-tool registry of its own (RN once did, and `useComponent` — which
    // registers into core's — then rendered nowhere on RN).
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useFrontendTool(toFrontendTool(config), deps);
    return;
  }

  if (config.name === "*") {
    // Rule 1: core's schema-less wildcard branch, whatever else was supplied.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useCoreRenderTool(
      {
        name: "*",
        render: config.render,
        ...(config.agentId ? { agentId: config.agentId } : {}),
      },
      deps,
    );
    return;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useCoreRenderTool(
    {
      name: config.name,
      parameters: config.parameters!,
      render: config.render,
      ...(config.agentId ? { agentId: config.agentId } : {}),
    },
    deps,
  );
}

/**
 * Builds the `ReactFrontendTool` for the `useFrontendTool` route.
 *
 * The renderer bridge mirrors react-core's own (`use-render-tool.tsx`): core's
 * registry invokes a renderer with `args` and an enum `status`, while this
 * hook's `render` is declared with core's public `parameters` / string-literal
 * `status` shape. Spreading per status keeps the discriminated union correlated
 * — and spreading `...props` (rather than picking fields) is also what keeps an
 * old `render: ({ args }) => …` painting unchanged at runtime.
 */
function toFrontendTool(config: ShimConfig): ReactFrontendTool {
  const render: ReactFrontendTool["render"] = (props) => {
    // Three byte-identical branches, deliberately: see the note above.
    if (props.status === ToolCallStatus.InProgress) {
      return config.render({ ...props, parameters: props.args });
    }
    if (props.status === ToolCallStatus.Executing) {
      return config.render({ ...props, parameters: props.args });
    }
    return config.render({ ...props, parameters: props.args });
  };

  return {
    name: config.name,
    ...(config.description !== undefined
      ? { description: config.description }
      : {}),
    ...(config.parameters !== undefined
      ? { parameters: config.parameters }
      : {}),
    ...(config.handler !== undefined ? { handler: config.handler } : {}),
    ...(config.agentId ? { agentId: config.agentId } : {}),
    render,
  };
}
