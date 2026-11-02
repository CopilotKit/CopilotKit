import { describe, expect, it } from "vitest";
import { isOperationShape, repairFences } from "../src/repair";

const valid =
  '{"version":"v1.0","updateComponents":{"surfaceId":"s","components":[{"id":"t","component":"Text","text":"Hi"}]}}';
// One } too many after a Table's rows: the most common slip.
const extraBrace =
  '{"version":"v1.0","updateComponents":{"surfaceId":"s","components":[{"id":"tbl","component":"Table","rows":[["Mon","9°C"]]}}]}}';
// A missing } at the end of the line.
const missingBrace =
  '{"version":"v1.0","updateComponents":{"surfaceId":"s","components":[{"id":"t","component":"Text","text":"Hi"}]}';

describe("repairFences", () => {
  it("repairs broken fence lines into operations and leaves valid lines and prose alone", () => {
    const text = `Intro {not json\n\n\`\`\`a2ui\n${valid}\n${extraBrace}\n${missingBrace}\n\`\`\`\nEnd`;
    const { text: out, repaired } = repairFences(text);
    expect(repaired).toEqual([extraBrace, missingBrace]);
    const lines = out.split("\n");
    expect(lines[0]).toBe("Intro {not json");
    expect(lines[3]).toBe(valid);
    const fixed = JSON.parse(lines[4]);
    expect(fixed.updateComponents.components[0]).toMatchObject({
      id: "tbl",
      component: "Table",
    });
    expect(JSON.parse(lines[5]).updateComponents.components[0].id).toBe("t");
  });

  it("keeps a line it cannot turn into an operation, so the client drops it as before", () => {
    const broken =
      '{"version":"v1.0","updateComponents":{"surfaceId":"s","components":[{"component":"Text"';
    const { text, repaired } = repairFences(`\`\`\`a2ui\n${broken}\n\`\`\``);
    expect(repaired).toEqual([]);
    expect(text).toContain(broken);
  });
});

describe("isOperationShape", () => {
  it("accepts one operation with a surface and named components, nothing else", () => {
    expect(isOperationShape(JSON.parse(valid))).toBe(true);
    expect(
      isOperationShape({
        version: "v1.0",
        updateComponents: { surfaceId: "s", components: [{ id: "x" }] },
      }),
    ).toBe(false);
    expect(
      isOperationShape({
        version: "v1.0",
        createSurface: { surfaceId: "s" },
        deleteSurface: { surfaceId: "s" },
      }),
    ).toBe(false);
    expect(
      isOperationShape({
        updateDataModel: { surfaceId: "s", path: "/a", value: 1 },
      }),
    ).toBe(false);
  });
});
