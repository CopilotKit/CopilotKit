import { describe, expect, it } from "vitest";
import { Subject } from "rxjs";
import { ReplayHold } from "../utils/replay-hold";

function collect(hold: ReplayHold<number>, source: Subject<number>) {
  const seen: (number | "complete" | "error")[] = [];
  const subscription = hold.through(source).subscribe({
    next: (value) => seen.push(value),
    complete: () => seen.push("complete"),
    error: () => seen.push("error"),
  });
  return { seen, subscription };
}

describe("ReplayHold", () => {
  it("holds values until released, then hands them on in order and passes later ones through", () => {
    const source = new Subject<number>();
    const hold = new ReplayHold<number>(true);
    const { seen } = collect(hold, source);
    source.next(1);
    source.next(2);
    expect(seen).toEqual([]);
    hold.release();
    expect(seen).toEqual([1, 2]);
    source.next(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("drops what it held on discard() and passes later values through", () => {
    const source = new Subject<number>();
    const hold = new ReplayHold<number>(true);
    const { seen } = collect(hold, source);
    source.next(1);
    source.next(2);
    hold.discard();
    source.next(3);
    hold.release();
    expect(seen).toEqual([3]);
  });

  it("holds again after hold() and keeps the order across a rejoin", () => {
    const source = new Subject<number>();
    const hold = new ReplayHold<number>(true);
    const { seen } = collect(hold, source);
    hold.release();
    source.next(1);
    hold.hold();
    source.next(2);
    source.next(3);
    expect(seen).toEqual([1]);
    hold.release();
    expect(seen).toEqual([1, 2, 3]);
  });

  it("passes everything through when created not holding", () => {
    const source = new Subject<number>();
    const { seen } = collect(new ReplayHold<number>(false), source);
    source.next(1);
    expect(seen).toEqual([1]);
  });

  it("releases what it holds before completing or erroring", () => {
    const completing = new Subject<number>();
    const first = collect(new ReplayHold<number>(true), completing);
    completing.next(1);
    completing.complete();
    expect(first.seen).toEqual([1, "complete"]);

    const failing = new Subject<number>();
    const second = collect(new ReplayHold<number>(true), failing);
    failing.next(1);
    failing.error(new Error("socket"));
    expect(second.seen).toEqual([1, "error"]);
  });

  it("drops nothing into a closed subscriber", () => {
    const source = new Subject<number>();
    const hold = new ReplayHold<number>(true);
    const { seen, subscription } = collect(hold, source);
    source.next(1);
    subscription.unsubscribe();
    hold.release();
    expect(seen).toEqual([]);
  });
});
