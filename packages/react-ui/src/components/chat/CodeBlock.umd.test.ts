import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import config from "../../../tsdown.config";

const umd = (
  config as unknown as Array<{
    plugins: Array<{ renderChunk: (code: string) => string }>;
  }>
)[1];
const expression = umd.plugins[0].renderChunk(
  'Promise.all([import("react-syntax-highlighter/dist/esm/prism"), import("react-syntax-highlighter/dist/esm/light")]).then((modules) => modules.map((module) => module.default))',
);
const highlighter = { Prism: () => "prism", Light: () => "light" };
const expected = [highlighter.Prism, highlighter.Light];

describe("UMD deferred highlighter resolver", () => {
  it("loads the dependency asynchronously in AMD", async () => {
    const define = Object.assign(() => undefined, { amd: {} });
    const require = (
      id: string | string[],
      resolve?: (value: unknown) => void,
    ) => {
      if (!Array.isArray(id))
        throw new Error("Synchronous AMD require is unavailable");
      expect(id).toEqual(["react-syntax-highlighter"]);
      resolve?.(highlighter);
    };
    await expect(
      runInNewContext(expression, { define, require, globalThis: undefined }),
    ).resolves.toEqual(expected);
  });

  it("loads the dependency through CommonJS", async () => {
    const require = (id: string) => {
      expect(id).toBe("react-syntax-highlighter");
      return highlighter;
    };
    await expect(runInNewContext(expression, { require })).resolves.toEqual(
      expected,
    );
  });

  it("uses the window global without globalThis", async () => {
    await expect(
      runInNewContext(expression, {
        globalThis: undefined,
        window: { ReactSyntaxHighlighter: highlighter },
      }),
    ).resolves.toEqual(expected);
  });

  it("returns undefined when no loader or global is available", async () => {
    await expect(
      runInNewContext(expression, { globalThis: undefined }),
    ).resolves.toEqual([undefined, undefined]);
  });
});
