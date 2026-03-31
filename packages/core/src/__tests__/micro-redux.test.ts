import { Observable, Subject } from "rxjs";
import { filter, map, tap } from "rxjs/operators";
import { describe, expect, it } from "vitest";
import {
  AnyAction,
  StoreLifecycleAction,
  createActionGroup,
  createEffect,
  createReducer,
  createSelector,
  createStore,
  empty,
  ofType,
  on,
  props,
  select,
} from "../utils/micro-redux";

const flushAsap = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("micro-redux", () => {
  describe("action groups", () => {
    it("creates typed action groups with and without props", () => {
      const group = createActionGroup("Some Group", {
        actionWithProps: props<{ prop: "type" }>(),
        actionWithoutProps: empty(),
      });

      const withProps = group.actionWithProps({ prop: "type" });
      const withoutProps = group.actionWithoutProps();

      const literalProp: "type" = withProps.prop;
      expect(literalProp).toBe("type");

      // @ts-expect-error payload is required for props-based action creator
      group.actionWithProps();
      // @ts-expect-error empty action creator does not accept payload
      group.actionWithoutProps({ prop: "type" });

      expect(withProps).toEqual({
        type: "[Some Group] actionWithProps",
        prop: "type",
      });
      expect(withoutProps).toEqual({
        type: "[Some Group] actionWithoutProps",
      });
      expect(group.actionWithProps.type).toBe("[Some Group] actionWithProps");
      expect(group.actionWithProps.match(withProps)).toBe(true);
      expect(group.actionWithProps.match(withoutProps)).toBe(false);
    });

    it("uses stable type-string format for namespaced actions", () => {
      const actions = createActionGroup("Feature Alpha", {
        boot: empty(),
        setValue: props<{ value: number }>(),
      });

      expect(actions.boot().type).toBe("[Feature Alpha] boot");
      expect(actions.setValue({ value: 42 }).type).toBe(
        "[Feature Alpha] setValue",
      );
    });
  });

  describe("reducers", () => {
    it("handles reducers with single and multiple action creators", () => {
      const counterActions = createActionGroup("Counter", {
        increment: empty(),
        reset: empty(),
        setCount: props<{ count: number }>(),
      });

      const reducer = createReducer(
        { count: 0, updates: 0 },
        on(counterActions.increment, (state) => ({
          ...state,
          count: state.count + 1,
          updates: state.updates + 1,
        })),
        on(counterActions.setCount, counterActions.reset, (state, action) => {
          if (counterActions.reset.match(action)) {
            return {
              ...state,
              count: 0,
              updates: state.updates + 1,
            };
          }

          return {
            ...state,
            count: action.count,
            updates: state.updates + 1,
          };
        }),
      );

      const unknownAction = { type: "[Counter] unknown" };
      const afterUnknown = reducer(undefined, unknownAction);
      expect(afterUnknown).toEqual({ count: 0, updates: 0 });

      const afterIncrement = reducer(afterUnknown, counterActions.increment());
      expect(afterIncrement).toEqual({ count: 1, updates: 1 });

      const afterSet = reducer(
        afterIncrement,
        counterActions.setCount({ count: 10 }),
      );
      expect(afterSet).toEqual({ count: 10, updates: 2 });

      const afterReset = reducer(afterSet, counterActions.reset());
      expect(afterReset).toEqual({ count: 0, updates: 3 });
    });

    it("runs multiple handlers for the same action in registration order", () => {
      const actions = createActionGroup("Order", {
        tick: empty(),
      });

      const reducer = createReducer(
        { history: [] as string[] },
        on(actions.tick, (state) => ({
          history: [...state.history, "first"],
        })),
        on(actions.tick, (state) => ({
          history: [...state.history, "second"],
        })),
      );

      expect(reducer(undefined, actions.tick())).toEqual({
        history: ["first", "second"],
      });
    });

    it("throws when on is called without creators", () => {
      expect(() =>
        (on as unknown as (...args: unknown[]) => unknown)(),
      ).toThrow("on requires at least one action creator and one reducer");
    });
  });

  describe("selectors and operators", () => {
    it("memoizes selectors based on last input references", () => {
      type State = {
        items: number[];
        multiplier: number;
        meta: { version: number };
      };

      const selectItems = (state: State) => state.items;
      const selectMultiplier = (state: State) => state.multiplier;

      let projectorCalls = 0;
      const selectScaled = createSelector(
        selectItems,
        selectMultiplier,
        (items, multiplier) => {
          projectorCalls += 1;
          return items.map((item) => item * multiplier);
        },
      );

      const state: State = {
        items: [1, 2],
        multiplier: 3,
        meta: { version: 1 },
      };

      const first = selectScaled(state);
      const second = selectScaled(state);
      const third = selectScaled({ ...state, meta: { version: 2 } });
      const fourth = selectScaled({ ...state, items: [1, 2] });

      expect(projectorCalls).toBe(2);
      expect(second).toBe(first);
      expect(third).toBe(first);
      expect(fourth).not.toBe(first);

      let stateProjectorCalls = 0;
      const selectMetaVersion = createSelector((s: State) => {
        stateProjectorCalls += 1;
        return s.meta.version;
      });

      expect(selectMetaVersion(state)).toBe(1);
      expect(selectMetaVersion(state)).toBe(1);
      expect(stateProjectorCalls).toBe(1);
    });

    it("select operator maps and deduplicates unchanged projected values", () => {
      const source$ = new Subject<{ count: number }>();
      const seen: number[] = [];

      const sub = source$
        .pipe(select((state) => state.count % 2))
        .subscribe((v) => {
          seen.push(v);
        });

      source$.next({ count: 1 });
      source$.next({ count: 3 });
      source$.next({ count: 4 });
      source$.next({ count: 8 });
      source$.next({ count: 9 });
      sub.unsubscribe();

      expect(seen).toEqual([1, 0, 1]);
    });

    it("ofType filters actions by creator type including multiple creators", () => {
      const actions = createActionGroup("Filter", {
        one: empty(),
        two: empty(),
        three: empty(),
      });

      const source$ = new Subject<AnyAction>();
      const seenSingle: string[] = [];
      const seenMulti: string[] = [];

      const sub1 = source$.pipe(ofType(actions.one)).subscribe((action) => {
        seenSingle.push(action.type);
      });
      const sub2 = source$
        .pipe(ofType(actions.one, actions.three))
        .subscribe((action) => {
          seenMulti.push(action.type);
        });

      source$.next(actions.one());
      source$.next(actions.two());
      source$.next(actions.three());

      sub1.unsubscribe();
      sub2.unsubscribe();

      expect(seenSingle).toEqual(["[Filter] one"]);
      expect(seenMulti).toEqual(["[Filter] one", "[Filter] three"]);
    });

    it("ofType throws when called with no creators", () => {
      expect(() => (ofType as unknown as () => unknown)()).toThrow(
        "ofType requires at least one action creator",
      );
    });
  });

  describe("store and effects", () => {
    it("allows dispatching before init", () => {
      const actions = createActionGroup("PreInit", {
        increment: empty(),
      });

      const reducer = createReducer(
        { count: 0 },
        on(actions.increment, (state) => ({ count: state.count + 1 })),
      );

      const store = createStore({ reducer });
      store.dispatch(actions.increment());

      expect(store.getState()).toEqual({ count: 1 });
    });

    it("auto-dispatches actions emitted by effects", async () => {
      const actions = createActionGroup("Effect", {
        trigger: empty(),
        completed: empty(),
      });

      const reducer = createReducer(
        { triggerCount: 0, completedCount: 0 },
        on(actions.trigger, (state) => ({
          ...state,
          triggerCount: state.triggerCount + 1,
        })),
        on(actions.completed, (state) => ({
          ...state,
          completedCount: state.completedCount + 1,
        })),
      );

      const effect = createEffect((actions$) =>
        actions$.pipe(
          ofType(actions.trigger),
          map(() => actions.completed()),
        ),
      );

      const store = createStore({ reducer, effects: [effect] });
      store.init();
      store.dispatch(actions.trigger());

      await flushAsap();

      expect(store.getState()).toEqual({ triggerCount: 1, completedCount: 1 });
    });

    it("supports ofType with props-based action creators inside effects", async () => {
      const someGroup = createActionGroup("hello", {
        world: props<{ a: 123 }>(),
        done: empty(),
      });

      const reducer = createReducer(
        { count: 0, done: 0 },
        on(someGroup.world, (state, action) => ({
          ...state,
          count: state.count + action.a,
        })),
        on(someGroup.done, (state) => ({
          ...state,
          done: state.done + 1,
        })),
      );

      const someEffect = createEffect((actions$) => {
        return actions$.pipe(
          ofType(someGroup.world),
          tap((action) => {
            // Compile-time assertion: `action` must expose the props payload.
            const payload: 123 = action.a;
            expect(payload).toBe(123);
          }),
          map(() => someGroup.done()),
        );
      });

      const store = createStore({ reducer, effects: [someEffect] });
      store.init();
      store.dispatch(someGroup.world({ a: 123 }));

      await flushAsap();

      expect(store.getState()).toEqual({ count: 123, done: 1 });
    });

    it("supports non-dispatching effects", async () => {
      const actions = createActionGroup("SideEffects", {
        trigger: empty(),
        completed: empty(),
      });

      const reducer = createReducer(
        { triggerCount: 0, completedCount: 0 },
        on(actions.trigger, (state) => ({
          ...state,
          triggerCount: state.triggerCount + 1,
        })),
        on(actions.completed, (state) => ({
          ...state,
          completedCount: state.completedCount + 1,
        })),
      );

      let sideEffectCount = 0;
      const effect = createEffect(
        (actions$) =>
          actions$.pipe(
            ofType(actions.trigger),
            tap(() => {
              sideEffectCount += 1;
            }),
            map(() => actions.completed()),
          ),
        { dispatch: false },
      );

      const store = createStore({ reducer, effects: [effect] });
      store.init();
      store.dispatch(actions.trigger());

      await flushAsap();

      expect(sideEffectCount).toBe(1);
      expect(store.getState()).toEqual({ triggerCount: 1, completedCount: 0 });
    });

    it("starts effects before dispatching init lifecycle action", async () => {
      const actions = createActionGroup("Lifecycle", {
        completed: empty(),
      });

      const reducer = createReducer(
        { completedCount: 0 },
        on(actions.completed, (state) => ({
          completedCount: state.completedCount + 1,
        })),
      );

      const effect = createEffect(
        (actions$: Observable<AnyAction | StoreLifecycleAction>) =>
          actions$.pipe(
            filter((action) => action.type === "@@micro-redux/init"),
            map(() => actions.completed()),
          ),
      );

      const store = createStore({ reducer, effects: [effect] });
      store.init();

      expect(store.getState()).toEqual({ completedCount: 0 });
      await flushAsap();
      expect(store.getState()).toEqual({ completedCount: 1 });
    });

    it("dispatches lifecycle actions during init and stop and keeps calls idempotent", () => {
      const reducer = createReducer({ count: 0 });
      const store = createStore({ reducer });

      const seenActionTypes: string[] = [];
      const sub = store.actions$.subscribe({
        next: (action) => seenActionTypes.push(action.type),
      });

      store.init();
      store.init();
      store.stop();
      store.stop();

      sub.unsubscribe();

      expect(seenActionTypes).toEqual([
        "@@micro-redux/init",
        "@@micro-redux/stop",
      ]);
    });

    it("unsubscribes effects on stop", async () => {
      const actions = createActionGroup("Stop", {
        trigger: empty(),
        completed: empty(),
      });

      const reducer = createReducer(
        { completedCount: 0 },
        on(actions.completed, (state) => ({
          completedCount: state.completedCount + 1,
        })),
      );

      const effect = createEffect((actions$) =>
        actions$.pipe(
          ofType(actions.trigger),
          map(() => actions.completed()),
        ),
      );

      const store = createStore({ reducer, effects: [effect] });
      store.init();
      store.stop();

      store.dispatch(actions.trigger());
      await flushAsap();

      expect(store.getState()).toEqual({ completedCount: 0 });
    });

    it("state$ emits initial state immediately and actions$ emits only dispatched actions", () => {
      const actions = createActionGroup("Streams", {
        ping: empty(),
      });

      const reducer = createReducer(
        { count: 0 },
        on(actions.ping, (state) => ({ count: state.count + 1 })),
      );

      const store = createStore({ reducer });

      const stateEmissions: number[] = [];
      const actionTypes: string[] = [];

      const stateSub = store.state$.subscribe((state) =>
        stateEmissions.push(state.count),
      );
      const actionSub = store.actions$.subscribe((action) =>
        actionTypes.push(action.type),
      );

      store.dispatch(actions.ping());

      stateSub.unsubscribe();
      actionSub.unsubscribe();

      expect(stateEmissions).toEqual([0, 1]);
      expect(actionTypes).toEqual(["[Streams] ping"]);
    });

    it("store.select uses selector projection with distinct output behavior", () => {
      const actions = createActionGroup("Select", {
        set: props<{ count: number }>(),
      });

      const reducer = createReducer(
        { count: 0 },
        on(actions.set, (_state, action) => ({ count: action.count })),
      );

      const store = createStore({ reducer });
      const parityValues: number[] = [];
      const sub = store
        .select((s) => s.count % 2)
        .subscribe((v) => parityValues.push(v));

      store.dispatch(actions.set({ count: 1 }));
      store.dispatch(actions.set({ count: 3 }));
      store.dispatch(actions.set({ count: 4 }));
      store.dispatch(actions.set({ count: 10 }));
      sub.unsubscribe();

      expect(parityValues).toEqual([0, 1, 0]);
    });

    it("fails fast when a dispatching effect errors", async () => {
      const actions = createActionGroup("Errors", {
        trigger: empty(),
      });

      const reducer = createReducer(
        { count: 0 },
        on(actions.trigger, (state) => ({ count: state.count + 1 })),
      );

      const healthyEffectCalls = { value: 0 };
      const healthyEffect = createEffect(
        (actions$) =>
          actions$.pipe(
            ofType(actions.trigger),
            tap(() => {
              healthyEffectCalls.value += 1;
            }),
            map(() => actions.trigger()),
          ),
        { dispatch: false },
      );

      const throwingEffect = createEffect((actions$) =>
        actions$.pipe(
          ofType(actions.trigger),
          map(() => {
            throw new Error("boom");
          }),
        ),
      );

      const store = createStore({
        reducer,
        effects: [healthyEffect, throwingEffect],
      });

      const actionErrors: unknown[] = [];
      const stateErrors: unknown[] = [];

      store.actions$.subscribe({
        error: (err) => actionErrors.push(err),
      });

      store.state$.subscribe({
        error: (err) => stateErrors.push(err),
      });

      store.init();
      store.dispatch(actions.trigger());

      await flushAsap();

      expect(healthyEffectCalls.value).toBe(1);
      expect(actionErrors).toHaveLength(1);
      expect(stateErrors).toHaveLength(1);
      expect((actionErrors[0] as Error).message).toBe("boom");
      expect((stateErrors[0] as Error).message).toBe("boom");

      expect(() => store.dispatch(actions.trigger())).toThrow(
        "Store is in a failed state due to an effect error",
      );
    });

    it("fails fast when a non-dispatching effect errors", async () => {
      const reducer = createReducer({ count: 0 });
      const throwingEffect = createEffect(
        () =>
          new Observable<never>((subscriber) => {
            subscriber.error(new Error("non-dispatching boom"));
          }),
        { dispatch: false },
      );

      const store = createStore({ reducer, effects: [throwingEffect] });

      const actionErrors: unknown[] = [];
      const stateErrors: unknown[] = [];

      store.actions$.subscribe({
        error: (err) => actionErrors.push(err),
      });
      store.state$.subscribe({
        error: (err) => stateErrors.push(err),
      });

      store.init();
      await flushAsap();

      expect(actionErrors).toHaveLength(1);
      expect(stateErrors).toHaveLength(1);
      expect((actionErrors[0] as Error).message).toBe("non-dispatching boom");
      expect((stateErrors[0] as Error).message).toBe("non-dispatching boom");
    });
  });
});
