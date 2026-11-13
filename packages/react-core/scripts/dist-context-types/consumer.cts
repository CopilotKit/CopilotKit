// A CommonJS consumer: under node16 resolution a `.cts` file resolves the
// `require` condition, so these imports read the `.d.cts` declarations.
// `scripts/assert-dist-context-types.mjs` runs tsc on it after each build.
import type { CopilotKitCoreReact } from "@copilotkit/react-core/v2/context";
import type { CopilotKitCoreReact as HeadlessCopilotKitCoreReact } from "@copilotkit/react-core/v2/headless";
// Import every export of the native entry that takes or returns the class:
// the script fails if the built entry has one that is not imported here.
import { useGenerativeUIRoot } from "@copilotkit/react-core/v2/generative-ui/native";

declare const core: CopilotKitCoreReact;

// The instance a React Native provider holds comes from `/v2/context`. The
// entries must accept it: `CopilotKitCoreReact` has private members, so a
// second declaration of the class (a bundled chunk) would not be assignable.
export const runtime = useGenerativeUIRoot(core, undefined);
export const headless: HeadlessCopilotKitCoreReact = core;

// Negative probes. With `skipLibCheck`, an import that does not resolve inside
// a `.d.ts` turns the type it names into `any`, and the checks above pass
// whatever the class. Each line below errors only while the type is real; if
// it stops erroring, tsc reports the unused `@ts-expect-error`.
// @ts-expect-error -- a plain object is not the class.
useGenerativeUIRoot({}, undefined);
// @ts-expect-error -- a plain object is not the class.
export const notHeadless: HeadlessCopilotKitCoreReact = {};
// @ts-expect-error -- the class is not a number.
export const notCore: number = core;
