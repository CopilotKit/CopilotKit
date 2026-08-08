// Type-only assertions. These fail at `check-types`, not at runtime — a type
// export cannot be observed by a runtime test, so this file is the guard.
import type { ReactToolCallRenderer } from "../headless";

// @copilotkit/react-native derives its public RenderToolProps from this type
// (packages/react-native/src/hooks/render-tool-types.ts). If this export is
// removed, RN's public types break.
//
// NOTE: `render` is a `React.ComponentType`, whose union arm `ComponentClass`
// has no bare call signature, so `Parameters<...["render"]>` fails the
// `(...args: any) => any` constraint (TS2344). `React.ComponentProps<...>` is
// the correct props extractor for a ComponentType — task 3's derivation must
// use it too.
type RendererProps = React.ComponentProps<
  ReactToolCallRenderer<{ city: string }>["render"]
>;

const inProgress: RendererProps = {
  name: "showWeather",
  toolCallId: "tc_1",
  args: {},
  status: "inProgress" as RendererProps["status"] & "inProgress",
  result: undefined,
};

void inProgress;
