import { Text } from "react-native";
import { z } from "zod";
import { useFrontendTool } from "../headless";
import type {
  FrontendToolRenderFunction,
  ReactToolCallRenderer,
} from "../headless";

/**
 * Type-level guard for `FrontendToolRenderFunction`.
 *
 * ─── Why this file is a `.test-d.tsx` and not a vitest suite ─────────────────
 *
 * There is nothing to observe at runtime: the whole property is "the compiler
 * rejects this". `packages/react-native/tsconfig.json` has `include: ["src"]`,
 * so `tsc --noEmit` (`nx run @copilotkit/react-native:check-types`) compiles
 * this file, and every `@ts-expect-error` below is therefore load-bearing —
 * `tsc` fails with "Unused '@ts-expect-error' directive" the moment one of them
 * starts compiling. The `.test-d.` infix keeps it out of vitest's
 * `src/**\/__tests__/**\/*.{test,spec}.{ts,tsx}` glob, which would otherwise
 * collect it as a suite with no tests in it.
 *
 * ─── What is being guarded ───────────────────────────────────────────────────
 *
 * `useFrontendTool`'s `render` is `ReactToolCallRenderer<T>["render"]`, a
 * `React.ComponentType`, so its return type is `ReactNode` and a bare string
 * compiles — then throws *Text strings must be rendered within a `<Text>`
 * component* on a device. `FrontendToolRenderFunction<T>` is the opt-in
 * annotation that rejects that at compile time, and this file pins both
 * directions of it plus the gap it exists to cover.
 */

type Args = { city: string };

// ─── 1. The gap. ─────────────────────────────────────────────────────────────
// core's contract accepts a bare string, which is exactly why the annotation
// below is worth having. If this line ever STOPS compiling, core narrowed its
// own contract and `FrontendToolRenderFunction` can be retired — `tsc` will say
// so here rather than leaving the type sitting around unnecessary.
const unannotated: ReactToolCallRenderer<Args>["render"] = (props) =>
  `Weather in ${props.args.city}`;
void unannotated;

// ─── 2. Accepted: an element-returning renderer. ─────────────────────────────
const returnsElement: FrontendToolRenderFunction<Args> = ({ args }) => (
  <Text>{args.city}</Text>
);

// `null` draws nothing, and is the documented way to suppress a tool call's UI.
const returnsNull: FrontendToolRenderFunction<Args> = () => null;

// The props come from core's contract UNCHANGED, so all three arms and both
// non-argument fields are reachable, and `args` is partial only while the call
// is still streaming.
const readsEveryProp: FrontendToolRenderFunction<Args> = (props) => {
  const label: string = `${props.name}/${props.toolCallId}`;
  if (props.status === "inProgress") {
    // `Partial<Args>` here: the agent has not finished writing the call.
    const partial: string | undefined = props.args.city;
    return <Text>{`${label} ${partial ?? ""}`}</Text>;
  }
  if (props.status === "executing") {
    const city: string = props.args.city;
    return <Text>{`${label} ${city}`}</Text>;
  }
  const result: string = props.result;
  return <Text>{`${label} ${result}`}</Text>;
};

// The props are core's contract and NOTHING else, which is what "derived, not
// re-declared" has to mean if it is to be worth anything. Without this, the
// props position could be widened to `any` — every assertion in §3 would still
// pass, because a directive fires on the RETURN type — and the derivation would
// have quietly stopped holding. `parameters` is the name core's OTHER render
// shape (`RenderToolProps`, the one `useRenderTool` uses) carries arguments
// under, so it is the mistake a reader is most likely to make here.
const readsAPropCoreDoesNotHave: FrontendToolRenderFunction<Args> = (props) => {
  // @ts-expect-error core's `ReactToolCallRenderer` props expose `args`
  void props.parameters;
  return null;
};
void readsAPropCoreDoesNotHave;

// Usable without a type argument — the default `Record<string, unknown>` keeps
// the bare spelling legal, unlike core's `RenderToolProps`, which has no
// default and fails `TS2314` when written bare.
const bare: FrontendToolRenderFunction = () => null;
void bare;

// ─── 3. Rejected: a bare-string-returning renderer. ──────────────────────────
// The exact shape that used to be rejected before RN's render type was deleted,
// and the reason a React Native consumer wants it rejected: this compiles
// against core's contract (§1) and throws on a device.
//
// Block bodies throughout so `tsc` reports the mismatch on the DECLARATION —
// which is the line each directive sits above. A concise-body arrow is reported
// at its expression instead, one line further down, where the directive would
// not reach it and would itself fail as unused.
//
// Without its directive: `TS2322: Type 'string' is not assignable to type
// 'ReactElement<unknown, string | JSXElementConstructor<any>>'`.
// @ts-expect-error a bare string is not `ReactElement | null`
const returnsString: FrontendToolRenderFunction<Args> = (props) => {
  return `Weather in ${props.args.city}`;
};
void returnsString;

// A number, an element array and `undefined` are all `ReactNode` and all
// equally undrawable by React Native's `FlatList`.
// @ts-expect-error a number is not `ReactElement | null`
const returnsNumber: FrontendToolRenderFunction<Args> = () => {
  return 42;
};
void returnsNumber;

// @ts-expect-error an element array is not a single `ReactElement`
const returnsArray: FrontendToolRenderFunction<Args> = () => {
  return [<Text key="a">a</Text>];
};
void returnsArray;

// @ts-expect-error `undefined` is not `ReactElement | null`
const returnsUndefined: FrontendToolRenderFunction<Args> = () => {
  return undefined;
};
void returnsUndefined;

// ─── 4. An annotated renderer still fits the hook it is for. ─────────────────
// A narrowing that core's `render` slot rejected would be useless, so the
// assignability is asserted rather than assumed.
function Probe() {
  useFrontendTool(
    {
      name: "showWeather",
      description: "Show the weather",
      parameters: z.object({ city: z.string() }),
      handler: async ({ city }) => city,
      render: returnsElement,
    },
    [],
  );

  useFrontendTool<Args>({ name: "silent", render: returnsNull });
  useFrontendTool<Args>({ name: "verbose", render: readsEveryProp });

  return null;
}
void Probe;
