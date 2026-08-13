import { expect, expectTypeOf, test } from "vitest";
import { array, lazy, object, parse, string } from "./index.js";
import type { Schema } from "./index.js";

interface Category {
  readonly children: Category[];
  readonly name: string;
}

test("lazy parses recursive schemas and preserves their declared type", () => {
  const category: Schema<Category> = lazy(() =>
    object({
      children: array(category),
      name: string(),
    }),
  );

  const output = parse(category, {
    children: [{ children: [], name: "Runtime" }],
    name: "Software",
  });

  expect(output.children[0]?.name).toBe("Runtime");
  expectTypeOf(output).toEqualTypeOf<Category>();
});
