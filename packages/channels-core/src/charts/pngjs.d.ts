// `pngjs` has no bundled types; declare the minimal surface used by
// render-smoke.test.ts. This lives in its own ambient declaration file
// (rather than inline in the test) because a `declare module "pngjs"` block
// placed in a file that also `import`s from "pngjs" is treated by
// TypeScript as an augmentation of the (untyped, unaugmentable) resolved
// module rather than a full ambient declaration, which fails with
// TS2665/TS7016.
declare module "pngjs" {
  export const PNG: {
    sync: {
      read: (buffer: Buffer) => { width: number; height: number; data: Buffer };
    };
  };
}
