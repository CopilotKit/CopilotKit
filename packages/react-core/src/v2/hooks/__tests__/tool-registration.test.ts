import { depsEqual } from "../tool-registration";

/**
 * Direct tests of the deps comparator behind `useFrontendTool` and
 * `useRenderTool`. The hook-level behavior lives in
 * use-tool-hooks-deps.test.tsx; these pin the comparator on cyclic plain data,
 * which must always terminate (#8513).
 */

type Node = { id?: number; next?: Node };

function selfCycle(id?: number): Node {
  const node: Node = id === undefined ? {} : { id };
  node.next = node;
  return node;
}

function twoNodeCycle(firstId?: number, secondId?: number): Node {
  const first: Node = firstId === undefined ? {} : { id: firstId };
  const second: Node = secondId === undefined ? {} : { id: secondId };
  first.next = second;
  second.next = first;
  return first;
}

describe("depsEqual", () => {
  it("compares acyclic plain data by value", () => {
    expect(depsEqual([{ value: 1 }], [{ value: 1 }])).toBe(true);
    expect(depsEqual([{ value: 1 }], [{ value: 2 }])).toBe(false);
    expect(depsEqual([[1, { a: [2] }]], [[1, { a: [2] }]])).toBe(true);
    expect(depsEqual([[1, { a: [2] }]], [[1, { a: [3] }]])).toBe(false);
  });

  it("treats a cyclic object as equal to itself", () => {
    const one = selfCycle();
    expect(depsEqual([one], [one])).toBe(true);
  });

  it("compares two same-shaped cycles by value", () => {
    expect(depsEqual([selfCycle(1)], [selfCycle(1)])).toBe(true);
    expect(depsEqual([selfCycle(1)], [selfCycle(2)])).toBe(false);
    expect(depsEqual([twoNodeCycle(1, 2)], [twoNodeCycle(1, 2)])).toBe(true);
    expect(depsEqual([twoNodeCycle(1, 2)], [twoNodeCycle(1, 3)])).toBe(false);
  });

  it("terminates when comparing cycles of different lengths", () => {
    // Structurally indistinguishable: both unfold to an endless `{ next }` chain.
    expect(() => depsEqual([selfCycle()], [twoNodeCycle()])).not.toThrow();
    expect(depsEqual([selfCycle()], [twoNodeCycle()])).toBe(true);
    expect(depsEqual([twoNodeCycle()], [selfCycle()])).toBe(true);

    // Same lengths as above, but the data along the cycle differs.
    expect(depsEqual([selfCycle(1)], [twoNodeCycle(1, 2)])).toBe(false);
    expect(depsEqual([twoNodeCycle(1, 2)], [selfCycle(1)])).toBe(false);
  });

  it("terminates when one object is compared against several partners", () => {
    const one = selfCycle(1);
    const three: Node = { id: 1 };
    three.next = { id: 1, next: { id: 1, next: three } };
    expect(depsEqual([one, one], [three, twoNodeCycle(1, 1)])).toBe(true);
    expect(depsEqual([one, one], [three, twoNodeCycle(1, 2)])).toBe(false);
  });
});
