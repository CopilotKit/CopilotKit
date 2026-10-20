import { describe, expect, it, vi } from "vitest";
import { loadExpress } from "../endpoints/load-express";
import type { RequireLike } from "../endpoints/load-express";

/** A `createRequire` stand-in whose two halves can fail independently. */
function fakeRequire({
  resolve,
  load,
}: {
  resolve: () => string;
  load: () => any;
}): RequireLike {
  const fn = ((specifier: string) => {
    expect(specifier).toBe("express");
    return load();
  }) as RequireLike;
  fn.resolve = (specifier: string) => {
    expect(specifier).toBe("express");
    return resolve();
  };
  return fn;
}

const notInstalled = () => {
  const error: NodeJS.ErrnoException = new Error(
    "Cannot find module 'express'",
  );
  error.code = "MODULE_NOT_FOUND";
  throw error;
};

describe("loadExpress", () => {
  it("returns the express module when it resolves", () => {
    const express = { Router: () => ({}) };
    expect(
      loadExpress(
        fakeRequire({
          resolve: () => "/express/index.js",
          load: () => express,
        }),
      ),
    ).toBe(express);
  });

  it("explains the optional peer when express is not installed", () => {
    expect(() =>
      loadExpress(fakeRequire({ resolve: notInstalled, load: () => ({}) })),
    ).toThrow(/optional peer dependency and is not installed/);
  });

  it("keeps the resolution failure as the cause", () => {
    try {
      loadExpress(fakeRequire({ resolve: notInstalled, load: () => ({}) }));
      expect.unreachable("loadExpress should have thrown");
    } catch (error) {
      expect((error as Error).cause).toMatchObject({
        code: "MODULE_NOT_FOUND",
      });
    }
  });

  it("does not claim express is missing when express itself fails to load", () => {
    // express resolves, so it IS installed. Whatever went wrong -- a broken
    // transitive dependency, a failed native binding, a patched copy that does
    // not parse -- is a different fault, and telling the reader to install a
    // package they already have sends them down the wrong path.
    const broken = new Error("Cannot find module 'router' from express");
    const load = vi.fn(() => {
      throw broken;
    });

    expect(() =>
      loadExpress(fakeRequire({ resolve: () => "/express/index.js", load })),
    ).toThrow(broken);
    expect(load).toHaveBeenCalledOnce();
  });
});
