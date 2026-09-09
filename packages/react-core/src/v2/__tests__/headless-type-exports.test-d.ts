// Type-only assertions. These fail at `check-types`, not at runtime — a type
// export cannot be observed by a runtime test, so this file is the guard.
//
// This file is NOT in vitest's `include` globs (`*.{test,spec}.{ts,tsx}` — a
// `.test-d.ts` basename does not match) and the package configures no
// `test.typecheck`, so nothing here ever executes. `tsc --noEmit` is the only
// thing that reads it, which is exactly the point: `expectTypeOf` failures are
// compile errors, not runtime ones. It is picked up by `tsc` because the
// package tsconfig includes `src/**/*`.
//
// `expectTypeOf` is the idiom already used for type assertions in this package
// (see `hooks/__tests__/use-agent-types.test.tsx`). Every positive assertion
// below is `toEqualTypeOf` — EXACT type identity — never assignability, and
// never a value-position annotation (`const x: T = { ... }`). Both of the
// weaker forms pass when the asserted type degrades to `any` or widens, which
// is precisely how the first version of this file managed to assert nothing.
import { expectTypeOf } from "vitest";
import type React from "react";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import type { ToolCallStatus } from "@copilotkit/core";
import type { ReactToolCallRenderer, RenderToolProps } from "../headless";

type Args = { city: string };

// @copilotkit/react-native re-exports this type verbatim from its own headless
// entry (`packages/react-native/src/headless.ts:147`) so RN consumers can
// annotate their own renderer objects with it. Nothing inside RN reads it: that
// re-export line and one prose mention in a comment
// (`packages/react-native/src/components/CopilotChat.tsx:173`) are its only two
// occurrences under `packages/react-native/src`. RN used to DERIVE a same-named
// type from it instead, in a local `hooks/render-tool-types.ts` that no longer
// exists — RN now ships no render-tool types of its own. Either way, remove this
// export and RN's public types break; the import above fails first.
//
// NOTE: `render` is a `React.ComponentType`, whose union arm `ComponentClass`
// has no bare call signature, so `Parameters<...["render"]>` fails the
// `(...args: any) => any` constraint (TS2344). `React.ComponentProps<...>` is
// the correct props extractor for a ComponentType, and therefore the extraction
// step this alias has to reproduce.
type RendererProps = React.ComponentProps<
  ReactToolCallRenderer<Args>["render"]
>;

/**
 * The canonical renderer contract, written out INDEPENDENTLY of the type under
 * test. Comparing `RendererProps` against a literal spelling rather than
 * against another expression derived from the same source is what makes the
 * assertion a real detector instead of a tautology: any change to
 * `ReactToolCallRenderer["render"]` — a renamed payload field, a widened
 * `status`, a dropped union arm, a lost `Partial` on streaming args, a
 * `result` that is no longer `undefined` before completion — fails here and
 * names the field.
 */
type CanonicalRendererProps =
  | {
      name: string;
      toolCallId: string;
      args: Partial<Args>;
      status: ToolCallStatus.InProgress;
      result: undefined;
    }
  | {
      name: string;
      toolCallId: string;
      args: Args;
      status: ToolCallStatus.Executing;
      result: undefined;
    }
  | {
      name: string;
      toolCallId: string;
      args: Args;
      status: ToolCallStatus.Complete;
      result: string;
    };

expectTypeOf<RendererProps>().toEqualTypeOf<CanonicalRendererProps>();

// Explicit `any` tripwire. Redundant with the exact assertion above by
// construction, and kept anyway because the failure it guards is silent: a
// derivation that collapses to `any` (a broken extractor, a `render` typed
// `ComponentType<any>`) satisfies every assignability check ever written
// against it.
expectTypeOf<RendererProps>().not.toBeAny();

// The payload arrives under `args`, and the arm keys are closed. Pinned
// separately from the union above because the field NAME is the half of the
// contract every registered renderer destructures, and a rename is the drift most
// likely to be made deliberately (this entry's OTHER public `RenderToolProps`
// calls the same payload `parameters` — see the divergence pinned below).
expectTypeOf<keyof RendererProps>().toEqualTypeOf<
  "name" | "toolCallId" | "args" | "status" | "result"
>();

// `status` is the `ToolCallStatus` enum from @copilotkit/core, not the bare
// string literals its members happen to carry. A renderer written against this
// contract narrows with the enum members, so an enum → literal widening here
// silently invalidates every such `switch`/`if` while still compiling on this
// side (a string-enum member is assignable to its own literal type, so the
// widening direction is the one `tsc` waves through).
expectTypeOf<RendererProps["status"]>().toEqualTypeOf<ToolCallStatus>();
expectTypeOf<RendererProps["status"]>().not.toEqualTypeOf<
  "inProgress" | "executing" | "complete"
>();

/**
 * KNOWN DIVERGENCE, pinned as a change-detector rather than endorsed.
 *
 * react-core ALSO exports a public `RenderToolProps` from this same entry
 * (`hooks/use-render-tool.tsx`), and it is a different type from the canonical
 * renderer contract above under the same name: generic over the schema rather
 * than the parsed args, payload under `parameters` instead of `args`, and
 * `status` as bare string literals instead of `ToolCallStatus`. The two meet
 * only in `useRenderTool`'s own bridge, which spreads enum-typed props into
 * the literal-typed slot and compiles because that assignability direction is
 * legal — so nothing else in the build fails when these two drift apart.
 *
 * These assertions therefore state what is TRUE TODAY. Converging the two
 * types is the intended direction, and doing so will fail here: that is the
 * signal. Update these assertions in the same change that converges them —
 * do not weaken them to assignability to make the failure go away.
 */
type WebRenderToolProps = RenderToolProps<StandardSchemaV1<unknown, Args>>;

expectTypeOf<WebRenderToolProps["status"]>().toEqualTypeOf<
  "inProgress" | "executing" | "complete"
>();
expectTypeOf<
  WebRenderToolProps["status"]
>().not.toEqualTypeOf<ToolCallStatus>();
expectTypeOf<keyof WebRenderToolProps>().toEqualTypeOf<
  "name" | "toolCallId" | "parameters" | "status" | "result"
>();
expectTypeOf<WebRenderToolProps>().not.toEqualTypeOf<CanonicalRendererProps>();
