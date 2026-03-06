/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BehaviorSubject,
  Observable,
  OperatorFunction,
  Subject,
  Subscription,
  asapScheduler,
} from "rxjs";
import { distinctUntilChanged, filter, map, observeOn } from "rxjs/operators";

/**
 * The minimal action shape used by this micro-redux implementation.
 */
export interface AnyAction {
  type: string;
}

/**
 * A typed action creator function with a `type` literal and runtime matcher.
 */
export type ActionCreator<
  Type extends string,
  Args extends unknown[] = unknown[],
  Action extends AnyAction & { type: Type } = { type: Type },
> = ((...args: Args) => Action) & {
  type: Type;
  match(action: AnyAction): action is Action;
};

/**
 * Extracts the action type produced by an action creator.
 */
export type ActionFromCreator<T> = T extends (...args: any[]) => infer A
  ? A
  : never;

/**
 * Extracts a union of actions produced by a tuple/array of action creators.
 */
export type ActionFromCreators<
  Creators extends readonly ActionCreator<string, any[], any>[],
> = ActionFromCreator<Creators[number]>;

/**
 * A reducer transforms state in response to actions.
 */
export type Reducer<State, Action extends AnyAction = AnyAction> = (
  state: State | undefined,
  action: Action,
) => State;

/**
 * A selector derives a value from state.
 */
export type Selector<State, Result> = (state: State) => Result;

/**
 * Marker config for action creators that accept no payload.
 */
export interface EmptyActionConfig {
  readonly kind: "empty";
}

const PROPS_MARKER: unique symbol = Symbol("props_marker");

/**
 * Marker config for action creators that require payload props.
 */
export interface PropsActionConfig<Props extends Record<string, unknown>> {
  readonly kind: "props";
  readonly [PROPS_MARKER]?: Props;
}

/**
 * Supported action creator config node in an action group.
 */
export type ActionConfig =
  | EmptyActionConfig
  | PropsActionConfig<Record<string, unknown>>;

/**
 * Shape of an action group declaration object.
 */
export type ActionGroupConfig = Record<string, ActionConfig>;

/**
 * Maps an action group declaration to a strongly typed action-creator object.
 */
export type ActionGroupResult<
  Source extends string,
  Config extends ActionGroupConfig,
> = {
  [K in keyof Config & string]: Config[K] extends PropsActionConfig<infer P>
    ? ActionCreator<`[${Source}] ${K}`, [P], { type: `[${Source}] ${K}` } & P>
    : ActionCreator<`[${Source}] ${K}`, [], { type: `[${Source}] ${K}` }>;
};

interface OnReducerEntry<
  State,
  Action extends AnyAction = AnyAction,
  Creators extends readonly ActionCreator<string, any[], any>[] =
    readonly ActionCreator<string, any[], any>[],
> {
  creators: Creators;
  reducer: (state: State, action: Action) => State;
}

type ActionFromOnReducerEntry<TEntry> =
  TEntry extends OnReducerEntry<any, infer TAction, any> ? TAction : never;

/**
 * Effect contract for streams that emit actions to dispatch.
 */
export interface DispatchingEffect<
  State,
  InputAction extends AnyAction = AnyAction,
  OutputAction extends AnyAction = AnyAction,
> {
  run: (
    actions$: Observable<InputAction>,
    state$: Observable<State>,
  ) => Observable<OutputAction>;
  dispatch: true;
}

/**
 * Effect contract for side-effect-only streams whose emissions are ignored.
 */
export interface NonDispatchingEffect<
  State,
  InputAction extends AnyAction = AnyAction,
> {
  run: (
    actions$: Observable<InputAction>,
    state$: Observable<State>,
  ) => Observable<unknown>;
  dispatch: false;
}

/**
 * Union of supported effect shapes.
 */
export type Effect<
  State,
  InputAction extends AnyAction = AnyAction,
  OutputAction extends AnyAction = AnyAction,
> =
  | DispatchingEffect<State, InputAction, OutputAction>
  | NonDispatchingEffect<State, InputAction>;

/**
 * Lifecycle actions dispatched by the store.
 */
export type StoreLifecycleAction =
  | { type: "@@micro-redux/init" }
  | { type: "@@micro-redux/stop" };

/**
 * Options for a dispatching effect.
 */
export interface DispatchingEffectOptions {
  dispatch?: true;
}

/**
 * Options for a non-dispatching effect.
 */
export interface NonDispatchingEffectOptions {
  dispatch: false;
}

const INTERNAL_ACTION_TYPES = {
  boot: "@@micro-redux/boot",
  init: "@@micro-redux/init",
  stop: "@@micro-redux/stop",
} as const;

const INTERNAL_BOOT_ACTION: AnyAction = { type: INTERNAL_ACTION_TYPES.boot };

/**
 * Builds a typed action creator from a type string and payload factory.
 */
function createTypedActionCreator<
  Type extends string,
  Args extends unknown[],
  Payload extends Record<string, unknown>,
>(
  type: Type,
  factory: (...args: Args) => Payload,
): ActionCreator<Type, Args, { type: Type } & Payload> {
  const creator = ((...args: Args) => ({
    ...factory(...args),
    type,
  })) as ActionCreator<Type, Args, { type: Type } & Payload>;

  creator.type = type;
  creator.match = (action: AnyAction): action is { type: Type } & Payload =>
    action.type === type;

  return creator;
}

/**
 * Declares a payload-based action config for `createActionGroup`.
 *
 * @example
 * ```ts
 * const actions = createActionGroup("User", {
 *   loaded: props<{ id: string }>(),
 * });
 * ```
 */
export function props<
  Props extends Record<string, unknown>,
>(): PropsActionConfig<Props> {
  return { kind: "props" };
}

/**
 * Declares a no-payload action config for `createActionGroup`.
 *
 * @example
 * ```ts
 * const actions = createActionGroup("User", {
 *   reset: empty(),
 * });
 * ```
 */
export function empty(): EmptyActionConfig {
  return { kind: "empty" };
}

/**
 * Creates a namespaced group of typed action creators.
 *
 * Action types are formatted as: `[Source] actionName`.
 */
export function createActionGroup<
  const Source extends string,
  const Config extends ActionGroupConfig,
>(source: Source, config: Config): ActionGroupResult<Source, Config> {
  const group = {} as ActionGroupResult<Source, Config>;

  for (const eventName of Object.keys(config) as Array<keyof Config & string>) {
    const eventConfig = config[eventName];
    if (!eventConfig) {
      continue;
    }

    const actionType = `[${source}] ${eventName}` as const;

    if (eventConfig.kind === "props") {
      group[eventName] = createTypedActionCreator(
        actionType,
        (payload: Record<string, unknown>) => ({ ...payload }),
      ) as ActionGroupResult<Source, Config>[typeof eventName];
      continue;
    }

    group[eventName] = createTypedActionCreator(
      actionType,
      () => ({}),
    ) as ActionGroupResult<Source, Config>[typeof eventName];
  }

  return group;
}

/**
 * Registers one reducer handler for one or more action creators.
 *
 * @throws Error when called without at least one action creator and reducer.
 */
export function on<
  State,
  const Creators extends readonly ActionCreator<string, any[], any>[],
  Action extends ActionFromCreators<Creators>,
>(
  ...args: [
    ...creators: Creators,
    reducer: (state: State, action: Action) => State,
  ]
): OnReducerEntry<State, Action, Creators> {
  if (args.length < 2) {
    throw new Error("on requires at least one action creator and one reducer");
  }

  const reducer = args[args.length - 1] as (
    state: State,
    action: Action,
  ) => State;
  const creators = args.slice(0, -1) as unknown as Creators;

  return {
    creators,
    reducer,
  };
}

/**
 * Creates a reducer from an initial state and `on(...)` handler entries.
 *
 * Unknown action types return the current state unchanged.
 */
export function createReducer<
  State,
  const Entries extends readonly OnReducerEntry<any, any, any>[],
>(
  initialState: State,
  ...entries: Entries
): Reducer<State, ActionFromOnReducerEntry<Entries[number]>> {
  type ReducerAction = ActionFromOnReducerEntry<Entries[number]>;

  const reducerMap = new Map<
    string,
    Array<(state: State, action: ReducerAction) => State>
  >();

  for (const entry of entries) {
    for (const creator of entry.creators) {
      const handlers = reducerMap.get(creator.type) ?? [];
      handlers.push(
        entry.reducer as unknown as (
          state: State,
          action: ReducerAction,
        ) => State,
      );
      reducerMap.set(creator.type, handlers);
    }
  }

  return (state: State | undefined, action: ReducerAction): State => {
    const currentState = state ?? initialState;
    const handlers = reducerMap.get(action.type);

    if (!handlers || handlers.length === 0) {
      return currentState;
    }

    let nextState = currentState;
    for (const handler of handlers) {
      nextState = handler(nextState, action);
    }
    return nextState;
  };
}

/**
 * Creates a memoized selector from a single projector.
 */
export function createSelector<State, Result>(
  projector: (state: State) => Result,
): Selector<State, Result>;

/**
 * Creates a memoized selector from input selectors and a projector.
 *
 * Memoization uses one-entry caching over the latest input selector values.
 */
export function createSelector<
  State,
  const Selectors extends readonly Selector<State, unknown>[],
  Result,
>(
  ...args: [
    ...selectors: Selectors,
    projector: (
      ...inputs: { [K in keyof Selectors]: ReturnType<Selectors[K]> }
    ) => Result,
  ]
): Selector<State, Result>;

/**
 * Creates a selector that caches and reuses the last computed result
 * when all input references are unchanged.
 */
export function createSelector<State, Result>(
  ...args:
    | [(state: State) => Result]
    | [
        ...selectors: Array<Selector<State, unknown>>,
        projector: (...inputs: unknown[]) => Result,
      ]
): Selector<State, Result> {
  if (args.length === 1) {
    const projector = args[0] as (state: State) => Result;
    let hasCached = false;
    let lastState: State | undefined;
    let lastResult: Result;

    return (state: State): Result => {
      if (hasCached && state === lastState) {
        return lastResult;
      }

      lastState = state;
      lastResult = projector(state);
      hasCached = true;
      return lastResult;
    };
  }

  const projector = args[args.length - 1] as (...inputs: unknown[]) => Result;
  const selectors = args.slice(0, -1) as Array<Selector<State, unknown>>;

  let hasCached = false;
  let lastInputs: unknown[] = [];
  let lastResult: Result;

  return (state: State): Result => {
    const inputs = selectors.map((selector) => selector(state));

    if (
      hasCached &&
      inputs.length === lastInputs.length &&
      inputs.every((value, index) => value === lastInputs[index])
    ) {
      return lastResult;
    }

    lastInputs = inputs;
    lastResult = projector(...inputs);
    hasCached = true;
    return lastResult;
  };
}

/**
 * RxJS operator that maps state emissions through a selector and suppresses
 * unchanged projected values via reference equality.
 */
export function select<State, Result>(
  selector: Selector<State, Result>,
): OperatorFunction<State, Result> {
  return (source$) => source$.pipe(map(selector), distinctUntilChanged());
}

/**
 * RxJS operator that filters an action stream by action creators and narrows
 * the output action type to the matched creator union.
 *
 * @throws Error when called without at least one action creator.
 */
export function ofType<
  const Creators extends readonly ActionCreator<string, any[], AnyAction>[],
>(
  ...creators: Creators
): OperatorFunction<AnyAction, ActionFromCreators<Creators>> {
  if (creators.length === 0) {
    throw new Error("ofType requires at least one action creator");
  }

  const actionTypes = new Set(creators.map((creator) => creator.type));
  return (source$) => {
    return source$.pipe(
      filter((action: AnyAction): action is ActionFromCreators<Creators> => {
        return actionTypes.has(action.type);
      }),
    );
  };
}

/**
 * Creates a dispatching effect. Emitted actions are automatically dispatched.
 */
export function createEffect<
  State,
  InputAction extends AnyAction,
  OutputAction extends AnyAction,
>(
  factory: (
    actions$: Observable<InputAction>,
    state$: Observable<State>,
  ) => Observable<OutputAction>,
  options?: DispatchingEffectOptions,
): DispatchingEffect<State, InputAction, OutputAction>;

/**
 * Creates a non-dispatching effect. Emitted values are ignored.
 */
export function createEffect<State, InputAction extends AnyAction>(
  factory: (
    actions$: Observable<InputAction>,
    state$: Observable<State>,
  ) => Observable<unknown>,
  options: NonDispatchingEffectOptions,
): NonDispatchingEffect<State, InputAction>;

/**
 * Creates an effect descriptor consumed by `createStore`.
 */
export function createEffect<
  State,
  InputAction extends AnyAction,
  OutputAction extends AnyAction,
>(
  factory: (
    actions$: Observable<InputAction>,
    state$: Observable<State>,
  ) => Observable<OutputAction>,
  options: DispatchingEffectOptions | NonDispatchingEffectOptions = {},
): Effect<State, InputAction, OutputAction> {
  if (options.dispatch === false) {
    return {
      run: factory,
      dispatch: false,
    };
  }

  return {
    run: factory,
    dispatch: true,
  };
}

/**
 * Store interface returned by `createStore`.
 */
export interface Store<State, Action extends AnyAction = AnyAction> {
  dispatch(action: Action): void;
  getState(): State;
  readonly state$: Observable<State>;
  readonly actions$: Observable<Action | StoreLifecycleAction>;
  select<Result>(selector: Selector<State, Result>): Observable<Result>;
  init(): void;
  stop(): void;
}

/**
 * Creates a small observable store with reducer + effects.
 *
 * Behavior:
 * - `init()` starts effects and dispatches `@@micro-redux/init`.
 * - `stop()` dispatches `@@micro-redux/stop` and unsubscribes all effects.
 * - Effect action observation is scheduled on `asapScheduler` to avoid
 *   synchronous re-entrancy in the effect loop.
 * - Any effect error triggers fail-fast teardown and errors both `actions$`
 *   and `state$`.
 */
export function createStore<
  State,
  Action extends AnyAction = AnyAction,
>(options: {
  reducer: Reducer<State, Action | StoreLifecycleAction>;
  effects?: Array<Effect<State, Action | StoreLifecycleAction, Action>>;
}): Store<State, Action> {
  const reducer = options.reducer;
  const effects = options.effects ?? [];

  let hasFatalError = false;
  let isRunning = false;
  let effectSubscriptions = new Subscription();

  let currentState = reducer(
    undefined,
    INTERNAL_BOOT_ACTION as Action | StoreLifecycleAction,
  );
  const stateSubject = new BehaviorSubject<State>(currentState);
  const actionsSubject = new Subject<Action | StoreLifecycleAction>();

  const dispatchInternal = (action: Action | StoreLifecycleAction): void => {
    if (hasFatalError) {
      throw new Error("Store is in a failed state due to an effect error");
    }

    currentState = reducer(currentState, action);
    stateSubject.next(currentState);
    actionsSubject.next(action);
  };

  const failFast = (error: unknown): void => {
    if (hasFatalError) {
      return;
    }

    hasFatalError = true;
    isRunning = false;
    effectSubscriptions.unsubscribe();
    effectSubscriptions = new Subscription();

    actionsSubject.error(error);
    stateSubject.error(error);
  };

  const startEffects = (): void => {
    for (const effect of effects) {
      const scheduledActions$ = actionsSubject
        .asObservable()
        .pipe(observeOn(asapScheduler));
      const state$ = stateSubject.asObservable();

      if (effect.dispatch) {
        const subscription = effect.run(scheduledActions$, state$).subscribe({
          next: (effectAction) => {
            if (hasFatalError) {
              return;
            }
            dispatchInternal(effectAction);
          },
          error: (error) => {
            failFast(error);
          },
        });

        effectSubscriptions.add(subscription);
        continue;
      }

      const subscription = effect.run(scheduledActions$, state$).subscribe({
        error: (error) => {
          failFast(error);
        },
      });

      effectSubscriptions.add(subscription);
    }
  };

  return {
    dispatch(action: Action): void {
      dispatchInternal(action);
    },
    getState(): State {
      return currentState;
    },
    get state$(): Observable<State> {
      return stateSubject.asObservable();
    },
    get actions$(): Observable<Action | StoreLifecycleAction> {
      return actionsSubject.asObservable();
    },
    select<Result>(selector: Selector<State, Result>): Observable<Result> {
      return stateSubject.asObservable().pipe(select(selector));
    },
    init(): void {
      if (hasFatalError || isRunning) {
        return;
      }

      isRunning = true;
      startEffects();

      if (hasFatalError) {
        return;
      }

      dispatchInternal({ type: INTERNAL_ACTION_TYPES.init });
    },
    stop(): void {
      if (hasFatalError || !isRunning) {
        return;
      }

      dispatchInternal({ type: INTERNAL_ACTION_TYPES.stop });
      effectSubscriptions.unsubscribe();
      effectSubscriptions = new Subscription();
      isRunning = false;
    },
  };
}
