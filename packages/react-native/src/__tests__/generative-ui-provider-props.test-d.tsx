import type React from "react";
import { expectTypeOf } from "vitest";
import type { Message } from "@ag-ui/client";
import {
  createGenerativeUI,
  GenerativeUIProvider,
  GenerativeUISurface,
  isGenerativeUIActivity,
} from "../generative-ui";
import type {
  GenerativeUIAccessibilityWrapperProps,
  GenerativeUIActivityWrapperProps,
  GenerativeUIHost,
  GenerativeUINodeFallbackProps,
  GenerativeUIProviderProps,
  GenerativeUIRejectedOperation,
  GenerativeUIRuntime,
  GenerativeUISurfaceProps,
  GenerativeUISurfaceRootProps,
  GenerativeUIToolConfig,
} from "../generative-ui";

/**
 * Type-level guard for the `@copilotkit/react-native/generative-ui` entry.
 *
 * A `.test-d.tsx` file, like `frontend-tool-render.test-d.tsx`: `tsc --noEmit`
 * (`nx run @copilotkit/react-native:check-types`) compiles it, so every
 * `@ts-expect-error` below is load-bearing, and the `.test-d.` infix keeps it
 * out of vitest's suite glob.
 */

const ui = createGenerativeUI({ id: "props-test", components: {} });

// ─── `theme` is not a React Native prop ──────────────────────────────────────
// The web `theme` sets `--a2ui-*` CSS variables. React Native has no CSS
// variables, so the RN host never applies it; accepting it would drop the
// value silently.

expectTypeOf<GenerativeUIProviderProps>().not.toHaveProperty("theme");
// The config type this entry exports is the React Native one, without theme.
expectTypeOf<GenerativeUIToolConfig>().not.toHaveProperty("theme");
expectTypeOf<GenerativeUIToolConfig>().toHaveProperty("agentIds");

export const withTheme = (
  // @ts-expect-error `theme` is not accepted on React Native.
  <GenerativeUIProvider ui={ui} theme={{}}>
    {null}
  </GenerativeUIProvider>
);

export const withoutTheme = (
  <GenerativeUIProvider ui={ui} agentIds={["agent"]}>
    {null}
  </GenerativeUIProvider>
);

// ─── The types a custom `host` and a custom Wrapper need are exported ────────

expectTypeOf<GenerativeUIActivityWrapperProps["rejected"]>().toEqualTypeOf<
  GenerativeUIRejectedOperation[]
>();
expectTypeOf<
  React.ComponentProps<GenerativeUIHost["SurfaceRoot"]>
>().toEqualTypeOf<GenerativeUISurfaceRootProps>();
expectTypeOf<
  React.ComponentProps<GenerativeUIHost["AccessibilityWrapper"]>
>().toEqualTypeOf<GenerativeUIAccessibilityWrapperProps>();
expectTypeOf<
  React.ComponentProps<GenerativeUIHost["NodeFallback"]>
>().toEqualTypeOf<GenerativeUINodeFallbackProps>();
expectTypeOf<GenerativeUIRuntime>().toBeObject();

// ─── isGenerativeUIActivity is a type guard ──────────────────────────────────

declare const messages: Message[];
const activities = messages.filter(isGenerativeUIActivity);
expectTypeOf(activities[0]!.role).toEqualTypeOf<"activity">();
expectTypeOf(
  activities[0]!.activityType,
).toEqualTypeOf<"generative-ui-surface">();

// ─── GenerativeUISurface: `components` is typed by `ui` ──────────────────────

const shopUI = createGenerativeUI({
  id: "surface-props-test",
  components: { Card: { component: () => null } },
});

export const typedComponents = (
  <GenerativeUISurface id="a" ui={shopUI} components={["Card"]} />
);

export const unknownComponent = (
  // @ts-expect-error "Nope" is not a component of shopUI.
  <GenerativeUISurface id="a" ui={shopUI} components={["Nope"]} />
);

export const componentsWithoutUI = (
  // @ts-expect-error `components` needs `ui`, which types its names.
  <GenerativeUISurface id="a" components={["Card"]} />
);

// The Wrapper of a named-target surface takes the Activity's Wrapper props.
expectTypeOf<NonNullable<GenerativeUISurfaceProps["Wrapper"]>>().toEqualTypeOf<
  React.ComponentType<GenerativeUIActivityWrapperProps>
>();
