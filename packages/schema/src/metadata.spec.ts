import { expect, test } from "vitest";
import {
  description,
  examples,
  getDescription,
  getExamples,
  getMetadata,
  getTitle,
  metadata,
  parse,
  registry,
  string,
  title,
} from "./index.js";

test("metadata annotates a schema without changing validation", () => {
  const source = string();

  const schema = metadata(source, {
    description: "A display name",
    title: "Name",
  });
  const output = parse(schema, "Ada");

  expect(schema).toBe(source);
  expect(output).toBe("Ada");
  expect(getMetadata(schema)).toEqual({
    description: "A display name",
    title: "Name",
  });
});

test("title attaches and reads a typed schema title", () => {
  const schema = title(string(), "Name");

  const value = getTitle(schema);

  expect(value).toBe("Name");
});

test("description and examples attach common JSON Schema metadata", () => {
  const schema = examples(description(string(), "A display name"), [
    "Ada",
    "Grace",
  ]);

  expect(getDescription(schema)).toBe("A display name");
  expect(getExamples(schema)).toEqual(["Ada", "Grace"]);
});

test("registry stores typed metadata outside schema instances", () => {
  const names = registry<{ readonly owner: string }>();
  const schema = string();

  names.add(schema, { owner: "runtime" });

  expect(names.has(schema)).toBe(true);
  expect(names.get(schema)).toEqual({ owner: "runtime" });
  expect(names.remove(schema)).toBe(true);
  expect(names.has(schema)).toBe(false);
});
