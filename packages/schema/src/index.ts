export interface Schema<Input, Output = Input> {
  readonly async: false;
  readonly expects: string;
  readonly kind: "schema";
  readonly type: string;
  readonly "~run": (input: unknown) => Output;
  readonly "~safe": (input: unknown) => InternalResult<Output>;
  readonly "~standard": StandardProps<Input, Output>;
  readonly "~types"?: {
    readonly input: Input;
    readonly output: Output;
  };
}

export interface AsyncSchema<Input, Output = Input> {
  readonly async: true;
  readonly expects: string;
  readonly kind: "schema";
  readonly type: string;
  readonly "~run": (input: unknown) => Promise<Output>;
  readonly "~standard": StandardProps<Input, Output>;
  readonly "~types"?: {
    readonly input: Input;
    readonly output: Output;
  };
}

export type GenericSchema<Input = unknown, Output = unknown> =
  | Schema<Input, Output>
  | AsyncSchema<Input, Output>;

export interface StandardIssue {
  readonly expected?: string;
  readonly input?: unknown;
  readonly issues?: readonly StandardIssue[];
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[];
  readonly type?: string;
}

export type StandardResult<Output> =
  | { readonly value: Output }
  | { readonly issues: readonly StandardIssue[] };

export interface InternalFailure {
  readonly issues: readonly Issue[];
  readonly output: undefined;
  readonly success: false;
}

export type InternalResult<Output> =
  | {
      readonly issues: undefined;
      readonly output: Output;
      readonly success: true;
    }
  | InternalFailure;

export interface StandardProps<Input, Output> {
  readonly jsonSchema: {
    readonly input: (options?: { readonly target?: "draft-07" }) => JsonSchema;
    readonly output: (options?: { readonly target?: "draft-07" }) => JsonSchema;
  };
  readonly types?: {
    readonly input: Input;
    readonly output: Output;
  };
  readonly validate: (
    value: unknown,
  ) => StandardResult<Output> | Promise<StandardResult<Output>>;
  readonly vendor: "@copilotkit/schema";
  readonly version: 1;
}

export interface Action<Input, Output = Input> {
  readonly actionType?: string;
  readonly kind: "transformation" | "validation";
  readonly requirement?: unknown;
  readonly "~run": (input: unknown) => Output;
  readonly "~types"?: {
    readonly input: Input;
    readonly output: Output;
  };
}

export interface ValidationAction<Input> extends Action<Input> {
  readonly kind: "validation";
}

export interface TransformationAction<Input, Output> extends Action<
  Input,
  Output
> {
  readonly kind: "transformation";
}

/** Marks the ordered point where a schema may expose partial output. */
export interface StreamingAction extends TransformationAction<
  unknown,
  unknown
> {
  readonly actionType: "streaming";
  readonly streaming: true;
}

export type Branded<TValue, TBrand extends PropertyKey> = TValue & {
  readonly __brand: TBrand;
};

export interface BrandAction<
  TBrand extends PropertyKey,
> extends TransformationAction<unknown, unknown> {
  readonly brand: true;
  readonly "~brand"?: TBrand;
}

export interface ReadonlyAction extends TransformationAction<unknown, unknown> {
  readonly readonly: true;
}

type ReadonlyOutput<TValue> = TValue extends
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined
  ? TValue
  : Readonly<TValue>;

export interface AsyncAction<Input, Output = Input> {
  readonly async: true;
  readonly kind: "transformation" | "validation";
  readonly "~run": (input: unknown) => Promise<Output>;
  readonly "~types"?: {
    readonly input: Input;
    readonly output: Output;
  };
}

export interface AsyncValidationAction<Input> extends AsyncAction<Input> {
  readonly kind: "validation";
}

export interface AsyncTransformationAction<Input, Output> extends AsyncAction<
  Input,
  Output
> {
  readonly kind: "transformation";
}

export type GenericAction<Input = unknown, Output = unknown> =
  | Action<Input, Output>
  | AsyncAction<Input, Output>;

export type InferActionInput<TAction extends GenericAction<unknown, unknown>> =
  NonNullable<TAction["~types"]>["input"];

export type InferActionOutput<TAction extends GenericAction<unknown, unknown>> =
  NonNullable<TAction["~types"]>["output"];

export type SchemaActions = readonly Action<unknown, unknown>[];

type NextSchemaOutput<
  TInput,
  TAction extends Action<unknown, unknown>,
> = TAction extends StreamingAction
  ? TInput
  : TAction extends BrandAction<infer TBrand>
    ? Branded<TInput, TBrand>
    : TAction extends ReadonlyAction
      ? ReadonlyOutput<TInput>
      : TAction extends ValidationAction<unknown>
        ? TInput
        : InferActionOutput<TAction>;

export type SchemaOutput<
  TInput,
  TActions extends SchemaActions,
> = TActions extends readonly [
  infer TFirst extends Action<unknown, unknown>,
  ...infer TRest extends SchemaActions,
]
  ? SchemaOutput<NextSchemaOutput<TInput, TFirst>, TRest>
  : TInput;

type ValidSchemaActions<
  TInput,
  TActions extends SchemaActions,
> = TActions extends readonly [
  infer TFirst extends Action<unknown, unknown>,
  ...infer TRest extends SchemaActions,
]
  ? TInput extends InferActionInput<TFirst>
    ? readonly [
        TFirst,
        ...ValidSchemaActions<NextSchemaOutput<TInput, TFirst>, TRest>,
      ]
    : never
  : readonly [];

export type AsyncSchemaActions = readonly GenericAction<unknown, unknown>[];

type NextAsyncSchemaOutput<
  TInput,
  TAction extends GenericAction<unknown, unknown>,
> = TAction extends StreamingAction
  ? TInput
  : TAction extends ValidationAction<unknown> | AsyncValidationAction<unknown>
    ? TInput
    : TAction extends BrandAction<infer TBrand>
      ? Branded<TInput, TBrand>
      : TAction extends ReadonlyAction
        ? ReadonlyOutput<TInput>
        : InferActionOutput<TAction>;

export type AsyncSchemaOutput<
  TInput,
  TActions extends AsyncSchemaActions,
> = TActions extends readonly [
  infer TFirst extends GenericAction<unknown, unknown>,
  ...infer TRest extends AsyncSchemaActions,
]
  ? AsyncSchemaOutput<NextAsyncSchemaOutput<TInput, TFirst>, TRest>
  : TInput;

type ValidAsyncSchemaActions<
  TInput,
  TActions extends AsyncSchemaActions,
> = TActions extends readonly [
  infer TFirst extends GenericAction<unknown, unknown>,
  ...infer TRest extends AsyncSchemaActions,
]
  ? TFirst extends AsyncAction<unknown, unknown>
    ? HasStreamingAction<TRest> extends true
      ? never
      : TInput extends InferActionInput<TFirst>
        ? readonly [
            TFirst,
            ...ValidAsyncSchemaActions<
              NextAsyncSchemaOutput<TInput, TFirst>,
              TRest
            >,
          ]
        : never
    : TInput extends InferActionInput<TFirst>
      ? readonly [
          TFirst,
          ...ValidAsyncSchemaActions<
            NextAsyncSchemaOutput<TInput, TFirst>,
            TRest
          >,
        ]
      : never
  : readonly [];

export type InferOutput<TSchema extends GenericSchema<unknown, unknown>> =
  NonNullable<TSchema["~types"]>["output"];

export type InferInput<TSchema extends GenericSchema<unknown, unknown>> =
  NonNullable<TSchema["~types"]>["input"];

type HasStreamingAction<TActions> = TActions extends readonly unknown[]
  ? Extract<TActions[number], StreamingAction> extends never
    ? false
    : true
  : false;

type HasDuplicateStreamingAction<
  TActions,
  TSeen extends boolean = false,
> = TActions extends readonly [infer TFirst, ...infer TRest]
  ? TFirst extends StreamingAction
    ? TSeen extends true
      ? true
      : HasDuplicateStreamingAction<TRest, true>
    : HasDuplicateStreamingAction<TRest, TSeen>
  : false;

type SupportsStreaming<TSchema> =
  TSchema extends Schema<string, unknown>
    ? true
    : TSchema extends {
          readonly entries: ObjectEntries;
        }
      ? true
      : TSchema extends {
            readonly item: Schema<unknown, unknown>;
          }
        ? true
        : false;

type ValidStreamingPlacement<TSchema, TActions> =
  HasStreamingAction<TActions> extends true
    ? HasDuplicateStreamingAction<TActions> extends true
      ? never
      : SupportsStreaming<TSchema> extends true
        ? unknown
        : never
    : unknown;

type StreamCheckpointOutput<TInput, TActions> = TActions extends readonly [
  infer TFirst extends GenericAction<unknown, unknown>,
  ...infer TRest extends AsyncSchemaActions,
]
  ? TFirst extends StreamingAction
    ? TInput
    : StreamCheckpointOutput<NextAsyncSchemaOutput<TInput, TFirst>, TRest>
  : TInput;

type StreamObject<TEntries extends ObjectEntries> = Simplify<{
  -readonly [TKey in keyof TEntries]?: InferStream<TEntries[TKey]>;
}>;

type StreamValue<TSchema> = TSchema extends {
  readonly options: infer TOptions extends readonly GenericSchema<
    unknown,
    unknown
  >[];
}
  ? InferStream<TOptions[number]>
  : TSchema extends {
        readonly entries: infer TEntries extends ObjectEntries;
      }
    ? StreamObject<TEntries>
    : TSchema extends {
          readonly item: infer TItem extends Schema<unknown, unknown>;
        }
      ? InferStream<TItem>[]
      : InferOutput<TSchema & GenericSchema<unknown, unknown>>;

/** Infer the value available at a schema's streaming checkpoint. */
export type InferStream<TSchema extends GenericSchema<unknown, unknown>> =
  TSchema extends {
    readonly actions: infer TActions;
    readonly wrapped: infer TWrapped extends GenericSchema<unknown, unknown>;
  }
    ? HasStreamingAction<TActions> extends true
      ? StreamCheckpointOutput<StreamValue<TWrapped>, TActions>
      : InferStream<TWrapped>
    : StreamValue<TSchema>;

export type ObjectEntries = Readonly<Record<string, Schema<unknown, unknown>>>;
export type GenericObjectEntries = Readonly<
  Record<string, GenericSchema<unknown, unknown>>
>;

type InputOptionalEntryKeys<TEntries extends ObjectEntries> = {
  [TKey in keyof TEntries]-?: TEntries[TKey] extends {
    readonly "~optional": true;
  }
    ? TKey
    : never;
}[keyof TEntries];

type OutputOptionalEntryKeys<TEntries extends ObjectEntries> = {
  [TKey in keyof TEntries]-?: TEntries[TKey] extends {
    readonly "~optional": true;
  }
    ? TEntries[TKey] extends { readonly "~default": unknown }
      ? never
      : TKey
    : never;
}[keyof TEntries];

type InputRequiredEntryKeys<TEntries extends ObjectEntries> = Exclude<
  keyof TEntries,
  InputOptionalEntryKeys<TEntries>
>;

type OutputRequiredEntryKeys<TEntries extends ObjectEntries> = Exclude<
  keyof TEntries,
  OutputOptionalEntryKeys<TEntries>
>;

type Simplify<TValue> = {
  [TKey in keyof TValue]: TValue[TKey];
};

export type ObjectInput<TEntries extends ObjectEntries> = Simplify<
  {
    -readonly [TKey in InputRequiredEntryKeys<TEntries>]: InferInput<
      TEntries[TKey]
    >;
  } & {
    -readonly [TKey in InputOptionalEntryKeys<TEntries>]?: InferInput<
      TEntries[TKey]
    >;
  }
>;

export type ObjectOutput<TEntries extends ObjectEntries> = Simplify<
  {
    -readonly [TKey in OutputRequiredEntryKeys<TEntries>]: InferOutput<
      TEntries[TKey]
    >;
  } & {
    -readonly [TKey in OutputOptionalEntryKeys<TEntries>]?: InferOutput<
      TEntries[TKey]
    >;
  }
>;

export interface ObjectSchema<TEntries extends ObjectEntries> extends Schema<
  ObjectInput<TEntries>,
  ObjectOutput<TEntries>
> {
  readonly entries: TEntries;
}

export interface LooseObjectSchema<
  TEntries extends ObjectEntries,
> extends Schema<
  ObjectInput<TEntries> & Record<string, unknown>,
  ObjectOutput<TEntries> & Record<string, unknown>
> {
  readonly entries: TEntries;
}

export type ObjectWithRestInput<
  TEntries extends ObjectEntries,
  TRest extends Schema<unknown, unknown>,
> = ObjectInput<TEntries> &
  Record<string, InferInput<TRest> | InferInput<TEntries[keyof TEntries]>>;

export type ObjectWithRestOutput<
  TEntries extends ObjectEntries,
  TRest extends Schema<unknown, unknown>,
> = ObjectOutput<TEntries> &
  Record<string, InferOutput<TRest> | InferOutput<TEntries[keyof TEntries]>>;

export interface ArraySchema<
  TItem extends Schema<unknown, unknown>,
> extends Schema<InferInput<TItem>[], InferOutput<TItem>[]> {
  readonly item: TItem;
}

type GenericInputOptionalEntryKeys<TEntries extends GenericObjectEntries> = {
  [TKey in keyof TEntries]-?: TEntries[TKey] extends {
    readonly "~optional": true;
  }
    ? TKey
    : never;
}[keyof TEntries];

type GenericOutputOptionalEntryKeys<TEntries extends GenericObjectEntries> = {
  [TKey in keyof TEntries]-?: TEntries[TKey] extends {
    readonly "~optional": true;
  }
    ? TEntries[TKey] extends { readonly "~default": unknown }
      ? never
      : TKey
    : never;
}[keyof TEntries];

export type AsyncObjectInput<TEntries extends GenericObjectEntries> = Simplify<
  {
    -readonly [TKey in Exclude<
      keyof TEntries,
      GenericInputOptionalEntryKeys<TEntries>
    >]: InferInput<TEntries[TKey]>;
  } & {
    -readonly [TKey in GenericInputOptionalEntryKeys<TEntries>]?: InferInput<
      TEntries[TKey]
    >;
  }
>;

export type AsyncObjectOutput<TEntries extends GenericObjectEntries> = Simplify<
  {
    -readonly [TKey in Exclude<
      keyof TEntries,
      GenericOutputOptionalEntryKeys<TEntries>
    >]: InferOutput<TEntries[TKey]>;
  } & {
    -readonly [TKey in GenericOutputOptionalEntryKeys<TEntries>]?: InferOutput<
      TEntries[TKey]
    >;
  }
>;

export interface AsyncObjectSchema<
  TEntries extends GenericObjectEntries,
> extends AsyncSchema<AsyncObjectInput<TEntries>, AsyncObjectOutput<TEntries>> {
  readonly entries: TEntries;
}

export interface AsyncArraySchema<
  TItem extends GenericSchema<unknown, unknown>,
> extends AsyncSchema<InferInput<TItem>[], InferOutput<TItem>[]> {
  readonly item: TItem;
}

export type SafeParseResult<TSchema extends GenericSchema<unknown, unknown>> =
  | {
      readonly issues: undefined;
      readonly output: InferOutput<TSchema>;
      readonly success: true;
    }
  | {
      readonly issues: readonly Issue[];
      readonly output: undefined;
      readonly success: false;
    };

export interface OptionalSchema<
  TWrapped extends Schema<unknown, unknown>,
> extends Schema<
  InferInput<TWrapped> | undefined,
  InferOutput<TWrapped> | undefined
> {
  readonly "~optional": true;
  readonly wrapped: TWrapped;
}

export type DefaultValue<TOutput> = TOutput | (() => TOutput);

export interface OptionalDefaultSchema<
  TWrapped extends Schema<unknown, unknown>,
> extends Schema<InferInput<TWrapped> | undefined, InferOutput<TWrapped>> {
  readonly "~default": DefaultValue<InferOutput<TWrapped>>;
  readonly "~optional": true;
  readonly wrapped: TWrapped;
}

export interface ExactOptionalSchema<
  TWrapped extends Schema<unknown, unknown>,
> extends Schema<InferInput<TWrapped>, InferOutput<TWrapped>> {
  readonly "~exactOptional": true;
  readonly "~optional": true;
  readonly wrapped: TWrapped;
}

export interface AsyncOptionalSchema<
  TWrapped extends GenericSchema<unknown, unknown>,
> extends AsyncSchema<
  InferInput<TWrapped> | undefined,
  InferOutput<TWrapped> | undefined
> {
  readonly "~optional": true;
  readonly wrapped: TWrapped;
}

export interface AsyncOptionalDefaultSchema<
  TWrapped extends GenericSchema<unknown, unknown>,
> extends AsyncSchema<InferInput<TWrapped> | undefined, InferOutput<TWrapped>> {
  readonly "~default": DefaultValue<InferOutput<TWrapped>>;
  readonly "~optional": true;
  readonly wrapped: TWrapped;
}

export interface AsyncExactOptionalSchema<
  TWrapped extends GenericSchema<unknown, unknown>,
> extends AsyncSchema<InferInput<TWrapped>, InferOutput<TWrapped>> {
  readonly "~exactOptional": true;
  readonly "~optional": true;
  readonly wrapped: TWrapped;
}

export type AsyncPartialEntries<TEntries extends GenericObjectEntries> = {
  [TKey in keyof TEntries]: TEntries[TKey] extends {
    readonly "~optional": true;
  }
    ? TEntries[TKey]
    : AsyncOptionalSchema<TEntries[TKey]>;
};

export type AsyncRequiredEntries<TEntries extends GenericObjectEntries> = {
  [TKey in keyof TEntries]: TEntries[TKey] extends {
    readonly wrapped: infer TWrapped extends GenericSchema<unknown, unknown>;
    readonly "~optional": true;
  }
    ? TWrapped
    : TEntries[TKey];
};

export interface NullableSchema<
  TWrapped extends Schema<unknown, unknown>,
> extends Schema<InferInput<TWrapped> | null, InferOutput<TWrapped> | null> {
  readonly wrapped: TWrapped;
}

export type PartialEntries<TEntries extends ObjectEntries> = {
  [TKey in keyof TEntries]: TEntries[TKey] extends OptionalSchema<
    Schema<unknown, unknown>
  >
    ? TEntries[TKey]
    : OptionalSchema<TEntries[TKey]>;
};

export type RequiredEntries<TEntries extends ObjectEntries> = {
  [TKey in keyof TEntries]: TEntries[TKey] extends OptionalSchema<
    infer TWrapped
  >
    ? TWrapped
    : TEntries[TKey];
};

export type PartialSelectedEntries<
  TEntries extends ObjectEntries,
  TKeys extends keyof TEntries,
> = Omit<TEntries, TKeys> & PartialEntries<Pick<TEntries, TKeys>>;

export type RequiredSelectedEntries<
  TEntries extends ObjectEntries,
  TKeys extends keyof TEntries,
> = Omit<TEntries, TKeys> & RequiredEntries<Pick<TEntries, TKeys>>;

export type MergedEntries<
  TLeft extends ObjectEntries,
  TRight extends ObjectEntries,
> = Omit<TLeft, keyof TRight> & TRight;

export type Literal = string | number | bigint | boolean | null | undefined;

export interface LiteralSchema<TValue extends Literal> extends Schema<TValue> {
  readonly literal: TValue;
}

export interface LengthInput {
  readonly length: number;
}

export interface SizeInput {
  readonly size: number;
}

export interface BlobValue {
  readonly size: number;
  readonly type: string;
}

export interface FileValue extends BlobValue {
  readonly lastModified: number;
  readonly name: string;
}

export type ValueInput = number | bigint | Date;

type ValueCategory<TValue extends ValueInput> = TValue extends number
  ? number
  : TValue extends bigint
    ? bigint
    : Date;

export type UnionOptions = readonly [
  Schema<unknown, unknown>,
  ...Schema<unknown, unknown>[],
];

export type GenericUnionOptions = readonly [
  GenericSchema<unknown, unknown>,
  ...GenericSchema<unknown, unknown>[],
];

export interface UnionSchema<TOptions extends UnionOptions> extends Schema<
  InferInput<TOptions[number]>,
  InferOutput<TOptions[number]>
> {
  readonly options: TOptions;
}

export type VariantOptions = readonly [
  ObjectSchema<ObjectEntries>,
  ObjectSchema<ObjectEntries>,
  ...ObjectSchema<ObjectEntries>[],
];

export interface VariantSchema<TOptions extends VariantOptions> extends Schema<
  InferInput<TOptions[number]>,
  InferOutput<TOptions[number]>
> {
  readonly discriminator: string;
  readonly options: TOptions;
}

export type GenericVariantOption = GenericSchema<unknown, unknown> & {
  readonly entries: GenericObjectEntries;
};

export type GenericVariantOptions = readonly [
  GenericVariantOption,
  GenericVariantOption,
  ...GenericVariantOption[],
];

export interface LazySchema<
  TInput,
  TOutput,
  TSchema extends Schema<TInput, TOutput>,
> extends Schema<TInput, TOutput> {
  readonly getSchema: () => TSchema;
}

export type IntersectOptions = readonly [
  Schema<unknown, unknown>,
  Schema<unknown, unknown>,
  ...Schema<unknown, unknown>[],
];

export type GenericIntersectOptions = readonly [
  GenericSchema<unknown, unknown>,
  GenericSchema<unknown, unknown>,
  ...GenericSchema<unknown, unknown>[],
];

type UnionToIntersection<TValue> = (
  TValue extends unknown ? (value: TValue) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

export type TupleItems = readonly Schema<unknown, unknown>[];
export type GenericTupleItems = readonly GenericSchema<unknown, unknown>[];

export type TupleInput<TItems extends TupleItems> = {
  -readonly [TKey in keyof TItems]: TItems[TKey] extends Schema<
    unknown,
    unknown
  >
    ? InferInput<TItems[TKey]>
    : never;
};

export type TupleOutput<TItems extends TupleItems> = {
  -readonly [TKey in keyof TItems]: TItems[TKey] extends Schema<
    unknown,
    unknown
  >
    ? InferOutput<TItems[TKey]>
    : never;
};

export type GenericTupleInput<TItems extends GenericTupleItems> = {
  -readonly [TKey in keyof TItems]: TItems[TKey] extends GenericSchema<
    unknown,
    unknown
  >
    ? InferInput<TItems[TKey]>
    : never;
};

export type GenericTupleOutput<TItems extends GenericTupleItems> = {
  -readonly [TKey in keyof TItems]: TItems[TKey] extends GenericSchema<
    unknown,
    unknown
  >
    ? InferOutput<TItems[TKey]>
    : never;
};

export interface TupleSchema<TItems extends TupleItems> extends Schema<
  TupleInput<TItems>,
  TupleOutput<TItems>
> {
  readonly items: TItems;
}

export type TupleWithRestInput<
  TItems extends TupleItems,
  TRest extends Schema<unknown, unknown>,
> = [...TupleInput<TItems>, ...InferInput<TRest>[]];

export type TupleWithRestOutput<
  TItems extends TupleItems,
  TRest extends Schema<unknown, unknown>,
> = [...TupleOutput<TItems>, ...InferOutput<TRest>[]];

type RecordOutput<TKey extends PropertyKey, TValue> = string extends TKey
  ? Record<TKey, TValue>
  : number extends TKey
    ? Record<TKey, TValue>
    : symbol extends TKey
      ? Record<TKey, TValue>
      : Partial<Record<TKey, TValue>>;

export type FunctionInput<
  TArguments extends TupleItems,
  TReturn extends Schema<unknown, unknown>,
> = (...arguments_: TupleInput<TArguments>) => InferInput<TReturn>;

export type FunctionOutput<
  TArguments extends TupleItems,
  TReturn extends Schema<unknown, unknown>,
> = (...arguments_: TupleInput<TArguments>) => InferOutput<TReturn>;

export interface CodecSchema<
  TEncoded extends Schema<unknown, unknown>,
  TDecoded extends Schema<unknown, unknown>,
> extends Schema<InferInput<TEncoded>, InferOutput<TDecoded>> {
  readonly decoded: TDecoded;
  readonly encoded: TEncoded;
  readonly "~encode": (output: InferOutput<TDecoded>) => InferOutput<TEncoded>;
}

export interface AsyncCodecSchema<
  TEncoded extends GenericSchema<unknown, unknown>,
  TDecoded extends GenericSchema<unknown, unknown>,
> extends AsyncSchema<InferInput<TEncoded>, InferOutput<TDecoded>> {
  readonly decoded: TDecoded;
  readonly encoded: TEncoded;
  readonly "~encode": (
    output: InferOutput<TDecoded>,
  ) => Promise<InferOutput<TEncoded>>;
}

export interface Issue {
  readonly expected: string;
  readonly input: unknown;
  readonly issues?: readonly Issue[];
  readonly message: string;
  readonly path: readonly PropertyKey[];
  readonly type: string;
}

export type GlobalMessage = (
  issue: Omit<Issue, "issues" | "message">,
) => string;

let globalMessage: GlobalMessage | undefined;
let asyncSchemaPrototype:
  | { readonly "~standard": StandardProps<unknown, unknown> }
  | undefined;
const statelessSchemas: unknown[] = [];
const hasOwn = Object.hasOwn;

/** Set the fallback message used for issues without a local message. */
export function setGlobalMessage(message: GlobalMessage): void {
  globalMessage = message;
}

/** Restore built-in validation messages. */
export function resetGlobalMessage(): void {
  globalMessage = undefined;
}

export class ValidationError extends Error {
  override readonly name = "ValidationError";

  constructor(readonly issues: readonly Issue[]) {
    super(issues[0]?.message ?? "Validation failed");
  }
}

type Mutable<TValue> = {
  -readonly [TKey in keyof TValue]: TValue[TKey];
};

interface SyncSchemaNodeConstructor {
  new <Input, Output>(
    type: string,
    expects: string,
    run: (input: unknown) => Output,
    safeRun: (input: unknown) => InternalResult<Output>,
  ): Schema<Input, Output>;
  prototype: Schema<unknown, unknown>;
}

/** Store one sync schema with shared constant metadata and adapters. */
const SyncSchemaNode = function (
  this: Mutable<Schema<unknown, unknown>>,
  type: string,
  expects: string,
  run: (input: unknown) => unknown,
  safeRun: (input: unknown) => InternalResult<unknown>,
): void {
  this.type = type;
  this.expects = expects;
  this["~run"] = run;
  this["~safe"] = safeRun;
} as unknown as SyncSchemaNodeConstructor;

SyncSchemaNode.prototype = {
  async: false,
  kind: "schema",
  get "~standard"(): StandardProps<unknown, unknown> {
    return {
      jsonSchema: {
        input: () => toJSONSchema(this, { target: "draft-07" }),
        output: () => toJSONSchema(this, { target: "draft-07" }),
      },
      validate: (value) => {
        const result = this["~safe"](value);
        if (result.success) {
          return { value: result.output };
        }
        return { issues: result.issues };
      },
      vendor: "@copilotkit/schema",
      version: 1,
    };
  },
} as Schema<unknown, unknown>;

/** Add a field in place. */
function schemaProperty<
  TSchema extends object,
  const TKey extends PropertyKey,
  const TValue,
>(
  schema: TSchema,
  key: TKey,
  value: TValue,
): TSchema & { readonly [TProperty in TKey]: TValue } {
  (schema as Record<PropertyKey, unknown>)[key] = value;
  return schema as TSchema & { readonly [TProperty in TKey]: TValue };
}

/** Set an own property without invoking Object.prototype.__proto__. */
function setObjectProperty(
  target: Record<PropertyKey, unknown>,
  key: PropertyKey,
  value: unknown,
): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  } else {
    target[key] = value;
  }
}

/** Build a sync schema. */
function makeSchema<Input, Output>(
  type: string,
  expects: string,
  run: (input: unknown) => Output,
): Schema<Input, Output> {
  return new SyncSchemaNode(
    type,
    expects,
    run,
    (input: unknown): InternalResult<Output> => {
      try {
        return {
          issues: undefined,
          output: run(input),
          success: true,
        };
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw error;
        }
        return {
          issues: error.issues,
          output: undefined,
          success: false,
        };
      }
    },
  );
}

/** Build an async schema. */
function makeAsyncSchema<Input, Output>(
  type: string,
  expects: string,
  run: (input: unknown) => Promise<Output>,
): AsyncSchema<Input, Output> {
  return {
    __proto__: (asyncSchemaPrototype ??= {
      get "~standard"(): StandardProps<unknown, unknown> {
        const schema = this as AsyncSchema<unknown, unknown>;
        return {
          jsonSchema: {
            input: () => ({
              $schema: "http://json-schema.org/draft-07/schema#",
            }),
            output: () => ({
              $schema: "http://json-schema.org/draft-07/schema#",
            }),
          },
          validate: async (value) => {
            try {
              return { value: await schema["~run"](value) };
            } catch (error) {
              if (!(error instanceof ValidationError)) {
                throw error;
              }
              return { issues: error.issues };
            }
          },
          vendor: "@copilotkit/schema",
          version: 1,
        };
      },
    }),
    async: true,
    expects,
    kind: "schema",
    type,
    "~run": run,
  } as unknown as AsyncSchema<Input, Output>;
}

function fail(
  type: string,
  expected: string,
  input: unknown,
  message?: string,
): never {
  throw new ValidationError([makeIssue(type, expected, input, message)]);
}

/** Build an issue. */
function makeIssue(
  type: string,
  expected: string,
  input: unknown,
  message?: string,
  defaultMessage = `Expected ${expected}`,
): Issue {
  const issue: Omit<Issue, "message"> & { message?: string } = {
    expected,
    input,
    path: [],
    type,
  };
  issue.message = message ?? globalMessage?.(issue) ?? defaultMessage;
  return issue as Issue;
}

/** Create a failure result without throwing. */
function failureResult(
  type: string,
  expected: string,
  input: unknown,
): InternalFailure {
  return {
    issues: [makeIssue(type, expected, input)],
    output: undefined,
    success: false,
  };
}

function prependPath(error: unknown, key: PropertyKey): never {
  if (!(error instanceof ValidationError)) {
    throw error;
  }
  throw new ValidationError(
    error.issues.map((issue) => ({
      ...issue,
      path: [key, ...issue.path],
    })),
  );
}

/** Add issue paths. */
function appendIssues(
  target: Issue[],
  issues: readonly Issue[],
  key: PropertyKey,
): void {
  for (const issue of issues) {
    target.push({
      ...issue,
      path: [key, ...issue.path],
    });
  }
}

/** Return whether a schema wraps an optional value. */
function isOptional(
  schema: Schema<unknown, unknown>,
): schema is OptionalSchema<Schema<unknown, unknown>> {
  return "~optional" in schema;
}

/** Create a schema that accepts strings. */
export function string(): Schema<string> {
  return (statelessSchemas[0] ??= new SyncSchemaNode(
    "string",
    "string",
    (input) => {
      if (typeof input === "string") {
        return input;
      }
      return fail("string", "string", input);
    },
    (input) =>
      typeof input === "string"
        ? { issues: undefined, output: input, success: true }
        : failureResult("string", "string", input),
  )) as Schema<string>;
}

/** Create a schema that accepts numbers other than NaN. */
export function number(): Schema<number> {
  return (statelessSchemas[1] ??= new SyncSchemaNode(
    "number",
    "number",
    (input) => {
      if (typeof input === "number" && input === input) {
        return input;
      }
      return fail("number", "number", input);
    },
    (input) =>
      typeof input === "number" && input === input
        ? { issues: undefined, output: input, success: true }
        : failureResult("number", "number", input),
  )) as Schema<number>;
}

/** Create a schema that accepts booleans. */
export function boolean(): Schema<boolean> {
  return (statelessSchemas[2] ??= new SyncSchemaNode(
    "boolean",
    "boolean",
    (input) => {
      if (typeof input === "boolean") {
        return input;
      }
      return fail("boolean", "boolean", input);
    },
    (input) =>
      typeof input === "boolean"
        ? { issues: undefined, output: input, success: true }
        : failureResult("boolean", "boolean", input),
  )) as Schema<boolean>;
}

/** Create a schema that accepts bigints. */
export function bigint(): Schema<bigint> {
  return (statelessSchemas[3] ??= makeSchema("bigint", "bigint", (input) => {
    if (typeof input === "bigint") {
      return input;
    }
    return fail("bigint", "bigint", input);
  })) as Schema<bigint>;
}

/** Create a schema that accepts valid Date instances. */
export function date(): Schema<Date> {
  return (statelessSchemas[4] ??= makeSchema("date", "Date", (input) => {
    if (input instanceof Date && input.getTime() === input.getTime()) {
      return input;
    }
    return fail("date", "Date", input);
  })) as Schema<Date>;
}

/** Create a schema that coerces input with JavaScript String. */
export function coerceString(): Schema<unknown, string> {
  return (statelessSchemas[5] ??= makeSchema(
    "coerce_string",
    "string-coercible value",
    (input) => String(input),
  )) as Schema<unknown, string>;
}

/** Create a schema that coerces input to a non-NaN number. */
export function coerceNumber(): Schema<unknown, number> {
  return (statelessSchemas[6] ??= makeSchema(
    "coerce_number",
    "number-coercible value",
    (input) => {
      try {
        const output = Number(input);
        return Number.isNaN(output)
          ? fail("coerce_number", "number-coercible value", input)
          : output;
      } catch {
        return fail("coerce_number", "number-coercible value", input);
      }
    },
  )) as Schema<unknown, number>;
}

/** Create a schema that coerces input with JavaScript Boolean. */
export function coerceBoolean(): Schema<unknown, boolean> {
  return (statelessSchemas[7] ??= makeSchema(
    "coerce_boolean",
    "boolean-coercible value",
    (input) => Boolean(input),
  )) as Schema<unknown, boolean>;
}

/** Create a schema that coerces input to a bigint. */
export function coerceBigint(): Schema<unknown, bigint> {
  return (statelessSchemas[8] ??= makeSchema(
    "coerce_bigint",
    "bigint-coercible value",
    (input) => {
      try {
        return BigInt(input as string | number | bigint | boolean);
      } catch {
        return fail("coerce_bigint", "bigint-coercible value", input);
      }
    },
  )) as Schema<unknown, bigint>;
}

/** Create a schema that coerces input to a valid Date. */
export function coerceDate(): Schema<unknown, Date> {
  return (statelessSchemas[9] ??= makeSchema(
    "coerce_date",
    "date-coercible value",
    (input) => {
      try {
        const output = new Date(input as string | number | Date);
        return Number.isNaN(output.getTime())
          ? fail("coerce_date", "date-coercible value", input)
          : output;
      } catch {
        return fail("coerce_date", "date-coercible value", input);
      }
    },
  )) as Schema<unknown, Date>;
}

/** Transform unknown input before validating it with a schema. */
export function preprocess<const TSchema extends Schema<unknown, unknown>>(
  operation: (input: unknown) => unknown,
  schema: TSchema,
): Schema<unknown, InferOutput<TSchema>> {
  return makeSchema("preprocess", schema.expects, (input) =>
    schema["~run"](operation(input)),
  );
}

/** Create a schema that accepts any input as unknown. */
export function unknown(): Schema<unknown> {
  return (statelessSchemas[10] ??= makeSchema(
    "unknown",
    "unknown",
    (input) => input,
  )) as Schema<unknown>;
}

/** Create a schema that rejects every input. */
export function never(): Schema<never> {
  return (statelessSchemas[11] ??= makeSchema("never", "never", (input) =>
    fail("never", "never", input),
  )) as Schema<never>;
}

/** Create a schema that accepts null. */
export function null_(): Schema<null> {
  return (statelessSchemas[12] ??= makeSchema("null", "null", (input) => {
    if (input === null) {
      return input;
    }
    return fail("null", "null", input);
  })) as Schema<null>;
}

/** Create a schema that accepts undefined. */
export function undefined_(): Schema<undefined> {
  return (statelessSchemas[13] ??= makeSchema(
    "undefined",
    "undefined",
    (input) => {
      if (input === undefined) {
        return input;
      }
      return fail("undefined", "undefined", input);
    },
  )) as Schema<undefined>;
}

/** Create a schema that accepts symbol values. */
export function symbol_(): Schema<symbol> {
  return (statelessSchemas[14] ??= makeSchema("symbol", "symbol", (input) => {
    if (typeof input === "symbol") {
      return input;
    }
    return fail("symbol", "symbol", input);
  })) as Schema<symbol>;
}

/** Create a schema that accepts only the JavaScript NaN value. */
export function nan(): Schema<number> {
  return (statelessSchemas[15] ??= makeSchema("nan", "NaN", (input) => {
    if (typeof input === "number" && Number.isNaN(input)) {
      return input;
    }
    return fail("nan", "NaN", input);
  })) as Schema<number>;
}

/** Create a schema that accepts Blob instances. */
export function blob(): Schema<BlobValue> {
  return (statelessSchemas[16] ??= (() => {
    const BlobConstructor = (
      globalThis as unknown as {
        readonly Blob?: abstract new (...arguments_: never[]) => object;
      }
    ).Blob;
    return makeSchema("blob", "Blob", (input) => {
      if (BlobConstructor && input instanceof BlobConstructor) {
        return input as BlobValue;
      }
      return fail("blob", "Blob", input);
    });
  })()) as Schema<BlobValue>;
}

/** Create a schema that accepts File instances. */
export function file(): Schema<FileValue> {
  return (statelessSchemas[17] ??= (() => {
    const FileConstructor = (
      globalThis as unknown as {
        readonly File?: abstract new (...arguments_: never[]) => object;
      }
    ).File;
    return makeSchema("file", "File", (input) => {
      if (FileConstructor && input instanceof FileConstructor) {
        return input as FileValue;
      }
      return fail("file", "File", input);
    });
  })()) as Schema<FileValue>;
}

/** Create a schema that accepts all values without changing them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function any_(): Schema<any> {
  return (statelessSchemas[18] ??= makeSchema(
    "any",
    "any",
    (input) => input,
  )) as Schema<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Create an undefined schema with a name suited to return values. */
export function void_(): Schema<void> {
  return (statelessSchemas[19] ??= makeSchema("void", "undefined", (input) => {
    if (input === undefined) {
      return input;
    }
    return fail("void", "undefined", input);
  })) as Schema<void>;
}

/** Create a schema from a user-provided type guard or predicate. */
export function custom<TOutput>(
  requirement: (input: unknown) => boolean,
  message = "Invalid value",
): Schema<TOutput> {
  return makeSchema("custom", "custom value", (input) => {
    if (requirement(input)) {
      return input as TOutput;
    }
    return fail("custom", "custom value", input, message);
  });
}

/** Create a schema that accepts one value from a fixed literal list. */
export function picklist<
  const TOptions extends readonly [Literal, ...Literal[]],
>(
  options: TOptions,
): Schema<TOptions[number]> & {
  readonly literals: TOptions;
} {
  const values = new Set<Literal>(options);
  return schemaProperty(
    makeSchema<TOptions[number], TOptions[number]>(
      "picklist",
      "picklist value",
      (input) => {
        if (values.has(input as Literal)) {
          return input as TOptions[number];
        }
        return fail("picklist", options.map(String).join(" | "), input);
      },
    ),
    "literals",
    options,
  );
}

/** Create a schema that accepts values from a TypeScript enum object. */
export function enum_<
  const TEnum extends Readonly<Record<string, string | number>>,
>(enumObject: TEnum): Schema<TEnum[keyof TEnum]> {
  const values = new Set<string | number>();
  for (const key of Object.keys(enumObject)) {
    if (Number.isNaN(Number(key))) {
      values.add(enumObject[key] as string | number);
    }
  }
  return makeSchema("enum", "enum value", (input) => {
    if (
      (typeof input === "string" || typeof input === "number") &&
      values.has(input)
    ) {
      return input as TEnum[keyof TEnum];
    }
    return fail("enum", "enum value", input);
  });
}

/** Create a schema that accepts instances of one class. */
export function instance<
  TClass extends abstract new (...args: never[]) => object,
>(class_: TClass): Schema<InstanceType<TClass>> {
  return makeSchema("instance", "class instance", (input) => {
    if (input instanceof class_) {
      return input as InstanceType<TClass>;
    }
    return fail("instance", "class instance", input);
  });
}

/** Create a schema that accepts one literal value. */
export function literal<const TValue extends Literal>(
  value: TValue,
): LiteralSchema<TValue> {
  const expected =
    typeof value === "string" ? JSON.stringify(value) : String(value);
  const schema = makeSchema<TValue, TValue>("literal", expected, (input) => {
    if (input === value) {
      return value;
    }
    return fail("literal", expected, input);
  }) as Mutable<LiteralSchema<TValue>>;
  schema.literal = value;
  return schema;
}

/** Create a schema that parses the known entries of an object. */
export function object<const TEntries extends ObjectEntries>(
  entries: TEntries,
): ObjectSchema<TEntries> {
  let keys: readonly string[] | undefined;
  const runSafely = (
    input: unknown,
  ): InternalResult<ObjectOutput<TEntries>> => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return failureResult("object", "object", input);
    }
    const output: Record<string, unknown> = {};
    let issues: Issue[] | undefined;
    for (const key of (keys ??= Object.keys(entries))) {
      const entry = entries[key]!;
      let value: unknown;
      if (hasOwn(input, key)) {
        value = (input as Record<string, unknown>)[key];
      } else if ("~optional" in entry && !("~default" in entry)) {
        continue;
      }
      const result = entry["~safe"](value);
      if (result.success) {
        output[key] = result.output;
      } else {
        appendIssues((issues ??= []), result.issues, key);
      }
    }
    return issues
      ? {
          issues,
          output: undefined,
          success: false,
        }
      : {
          issues: undefined,
          output: output as ObjectOutput<TEntries>,
          success: true,
        };
  };
  const schema = new SyncSchemaNode<
    ObjectInput<TEntries>,
    ObjectOutput<TEntries>
  >(
    "object",
    "object",
    (input) => {
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        return fail("object", "object", input);
      }
      const output: Record<string, unknown> = {};
      let issues: Issue[] | undefined;
      for (const key of (keys ??= Object.keys(entries))) {
        const entry = entries[key]!;
        let value: unknown;
        if (hasOwn(input, key)) {
          value = (input as Record<string, unknown>)[key];
        } else if ("~optional" in entry && !("~default" in entry)) {
          continue;
        }
        try {
          output[key] = entry["~run"](value);
        } catch (error) {
          if (!(error instanceof ValidationError)) {
            throw error;
          }
          appendIssues((issues ??= []), error.issues, key);
        }
      }
      if (issues) {
        throw new ValidationError(issues);
      }
      return output as ObjectOutput<TEntries>;
    },
    runSafely,
  ) as Mutable<ObjectSchema<TEntries>>;
  schema.entries = entries;
  return schema;
}

/** Build an async object schema. */
export function objectAsync<const TEntries extends GenericObjectEntries>(
  entries: TEntries,
): AsyncObjectSchema<TEntries> {
  let keys: readonly string[] | undefined;
  return schemaProperty(
    makeAsyncSchema<AsyncObjectInput<TEntries>, AsyncObjectOutput<TEntries>>(
      "object",
      "object",
      async (input) => {
        if (
          input === null ||
          typeof input !== "object" ||
          Array.isArray(input)
        ) {
          return fail("object", "object", input);
        }
        const source = input as Record<string, unknown>;
        const output: Record<string, unknown> = {};
        const issues: Issue[] = [];
        for (const key of (keys ??= Object.keys(entries))) {
          const entry = entries[key]!;
          let value: unknown;
          if (Object.hasOwn(source, key)) {
            value = source[key];
          } else if ("~optional" in entry && !("~default" in entry)) {
            continue;
          }
          try {
            output[key] = await entry["~run"](value);
          } catch (error) {
            if (!(error instanceof ValidationError)) {
              throw error;
            }
            appendIssues(issues, error.issues, key);
          }
        }
        if (issues.length > 0) {
          throw new ValidationError(issues);
        }
        return output as AsyncObjectOutput<TEntries>;
      },
    ),
    "entries",
    entries,
  );
}

/** Create an async object schema that rejects unknown entries. */
export function strictObjectAsync<const TEntries extends GenericObjectEntries>(
  entries: TEntries,
): AsyncObjectSchema<TEntries> {
  const base = objectAsync(entries);
  return schemaProperty(
    makeAsyncSchema<AsyncObjectInput<TEntries>, AsyncObjectOutput<TEntries>>(
      "strict_object",
      "object",
      async (input) => {
        if (input !== null && typeof input === "object") {
          for (const key of Object.keys(input)) {
            if (!Object.hasOwn(entries, key)) {
              return fail(
                "strict_object",
                "known object key",
                input,
                `Unexpected key "${key}"`,
              );
            }
          }
        }
        return await base["~run"](input);
      },
    ),
    "entries",
    entries,
  );
}

/** Create an async object schema that keeps unknown entries. */
export function looseObjectAsync<const TEntries extends GenericObjectEntries>(
  entries: TEntries,
): AsyncSchema<
  AsyncObjectInput<TEntries> & Record<string, unknown>,
  AsyncObjectOutput<TEntries> & Record<string, unknown>
> & {
  readonly entries: TEntries;
} {
  const base = objectAsync(entries);
  return schemaProperty(
    makeAsyncSchema<
      AsyncObjectInput<TEntries> & Record<string, unknown>,
      AsyncObjectOutput<TEntries> & Record<string, unknown>
    >("loose_object", "object", async (input) => ({
      ...(input as Record<string, unknown>),
      ...(await base["~run"](input)),
    })),
    "entries",
    entries,
  );
}

/** Create an async object schema with a rest entry schema. */
export function objectWithRestAsync<
  const TEntries extends GenericObjectEntries,
  const TRest extends GenericSchema<unknown, unknown>,
>(
  entries: TEntries,
  rest: TRest,
): AsyncSchema<
  AsyncObjectInput<TEntries> &
    Record<string, InferInput<TRest> | InferInput<TEntries[keyof TEntries]>>,
  AsyncObjectOutput<TEntries> &
    Record<string, InferOutput<TRest> | InferOutput<TEntries[keyof TEntries]>>
> {
  const base = objectAsync(entries);
  return makeAsyncSchema("object_with_rest", "object", async (input) => {
    const output: Record<string, unknown> = {
      ...(await base["~run"](input)),
    };
    const source = input as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      if (!Object.hasOwn(entries, key)) {
        try {
          setObjectProperty(output, key, await rest["~run"](source[key]));
        } catch (error) {
          prependPath(error, key);
        }
      }
    }
    return output as AsyncObjectOutput<TEntries> &
      Record<
        string,
        InferOutput<TRest> | InferOutput<TEntries[keyof TEntries]>
      >;
  });
}

/** Create an object schema that rejects unknown entries. */
export function strictObject<const TEntries extends ObjectEntries>(
  entries: TEntries,
): ObjectSchema<TEntries> {
  const base = object(entries);
  return schemaProperty(
    makeSchema<ObjectInput<TEntries>, ObjectOutput<TEntries>>(
      "strict_object",
      "object",
      (input) => {
        if (input !== null && typeof input === "object") {
          for (const key of Object.keys(input)) {
            if (!Object.hasOwn(entries, key)) {
              return fail(
                "strict_object",
                "known object key",
                input,
                `Unexpected key "${key}"`,
              );
            }
          }
        }
        return base["~run"](input);
      },
    ),
    "entries",
    entries,
  );
}

/** Create an object schema that keeps unknown entries unchanged. */
export function looseObject<const TEntries extends ObjectEntries>(
  entries: TEntries,
): LooseObjectSchema<TEntries> {
  const base = object(entries);
  return schemaProperty(
    makeSchema<
      ObjectInput<TEntries> & Record<string, unknown>,
      ObjectOutput<TEntries> & Record<string, unknown>
    >("loose_object", "object", (input) => {
      const parsed = base["~run"](input);
      return {
        ...(input as Record<string, unknown>),
        ...parsed,
      } as ObjectOutput<TEntries> & Record<string, unknown>;
    }),
    "entries",
    entries,
  );
}

/** Create an object schema that parses unknown entries with a rest schema. */
export function objectWithRest<
  const TEntries extends ObjectEntries,
  const TRest extends Schema<unknown, unknown>,
>(
  entries: TEntries,
  rest: TRest,
): Schema<
  ObjectWithRestInput<TEntries, TRest>,
  ObjectWithRestOutput<TEntries, TRest>
> {
  const base = object(entries);
  return makeSchema("object_with_rest", "object", (input) => {
    const output: Record<string, unknown> = {
      ...base["~run"](input),
    };
    const source = input as Record<string, unknown>;
    let key = "";
    try {
      for (key of Object.keys(source)) {
        if (!Object.hasOwn(entries, key)) {
          setObjectProperty(output, key, rest["~run"](source[key]));
        }
      }
    } catch (error) {
      prependPath(error, key);
    }
    return output as ObjectWithRestOutput<TEntries, TRest>;
  });
}

/** Select object entries by key. */
export function pick<
  const TEntries extends ObjectEntries,
  const TKeys extends readonly (keyof TEntries)[],
>(
  schema: ObjectSchema<TEntries>,
  keys: TKeys,
): ObjectSchema<Pick<TEntries, TKeys[number]>> {
  const entries: Record<string, Schema<unknown, unknown>> = {};
  for (const key of keys) {
    if (typeof key === "string") {
      entries[key] = schema.entries[key]!;
    }
  }
  return object(entries) as ObjectSchema<Pick<TEntries, TKeys[number]>>;
}

/** Remove object entries by key. */
export function omit<
  const TEntries extends ObjectEntries,
  const TKeys extends readonly (keyof TEntries)[],
>(
  schema: ObjectSchema<TEntries>,
  keys: TKeys,
): ObjectSchema<Omit<TEntries, TKeys[number]>> {
  const excluded = new Set<PropertyKey>(keys);
  const entries: Record<string, Schema<unknown, unknown>> = {};
  for (const key of Object.keys(schema.entries)) {
    if (!excluded.has(key)) {
      entries[key] = schema.entries[key]!;
    }
  }
  return object(entries) as ObjectSchema<Omit<TEntries, TKeys[number]>>;
}

/** Make every entry in an object schema optional. */
export function partial<const TEntries extends ObjectEntries>(
  schema: ObjectSchema<TEntries>,
): ObjectSchema<PartialEntries<TEntries>>;
/** Make selected entries in an object schema optional. */
export function partial<
  const TEntries extends ObjectEntries,
  const TKeys extends readonly (keyof TEntries)[],
>(
  schema: ObjectSchema<TEntries>,
  keys: TKeys,
): ObjectSchema<PartialSelectedEntries<TEntries, TKeys[number]>>;
export function partial<const TEntries extends ObjectEntries>(
  schema: ObjectSchema<TEntries>,
  keys?: readonly (keyof TEntries)[],
): ObjectSchema<ObjectEntries> {
  const selected = keys === undefined ? undefined : new Set(keys);
  const entries: Record<string, Schema<unknown, unknown>> = {};
  for (const key of Object.keys(schema.entries)) {
    const entry = schema.entries[key]!;
    entries[key] =
      (selected === undefined || selected.has(key)) && !isOptional(entry)
        ? optional(entry)
        : entry;
  }
  return object(entries);
}

/** Make every entry in an object schema required. */
export function required<const TEntries extends ObjectEntries>(
  schema: ObjectSchema<TEntries>,
): ObjectSchema<RequiredEntries<TEntries>>;
/** Make selected entries in an object schema required. */
export function required<
  const TEntries extends ObjectEntries,
  const TKeys extends readonly (keyof TEntries)[],
>(
  schema: ObjectSchema<TEntries>,
  keys: TKeys,
): ObjectSchema<RequiredSelectedEntries<TEntries, TKeys[number]>>;
export function required<const TEntries extends ObjectEntries>(
  schema: ObjectSchema<TEntries>,
  keys?: readonly (keyof TEntries)[],
): ObjectSchema<ObjectEntries> {
  const selected = keys === undefined ? undefined : new Set(keys);
  const entries: Record<string, Schema<unknown, unknown>> = {};
  for (const key of Object.keys(schema.entries)) {
    const entry = schema.entries[key]!;
    entries[key] =
      (selected === undefined || selected.has(key)) && isOptional(entry)
        ? entry.wrapped
        : entry;
  }
  return object(entries);
}

/** Make every entry in an async object schema optional. */
export function partialAsync<const TEntries extends GenericObjectEntries>(
  schema: AsyncObjectSchema<TEntries>,
): AsyncObjectSchema<AsyncPartialEntries<TEntries>> {
  const entries: Record<string, GenericSchema<unknown, unknown>> = {};
  for (const key of Object.keys(schema.entries)) {
    const entry = schema.entries[key]!;
    entries[key] = "~optional" in entry ? entry : optionalAsync(entry);
  }
  return objectAsync(entries) as AsyncObjectSchema<
    AsyncPartialEntries<TEntries>
  >;
}

/** Make every entry in an async object schema required. */
export function requiredAsync<const TEntries extends GenericObjectEntries>(
  schema: AsyncObjectSchema<TEntries>,
): AsyncObjectSchema<AsyncRequiredEntries<TEntries>> {
  const entries: Record<string, GenericSchema<unknown, unknown>> = {};
  for (const key of Object.keys(schema.entries)) {
    const entry = schema.entries[key]!;
    entries[key] =
      "~optional" in entry && "wrapped" in entry
        ? (entry.wrapped as GenericSchema<unknown, unknown>)
        : entry;
  }
  return objectAsync(entries) as AsyncObjectSchema<
    AsyncRequiredEntries<TEntries>
  >;
}

/** Add or replace entries in an object schema. */
export function extend<
  const TEntries extends ObjectEntries,
  const TExtension extends ObjectEntries,
>(
  schema: ObjectSchema<TEntries>,
  entries: TExtension,
): ObjectSchema<MergedEntries<TEntries, TExtension>> {
  return object({
    ...schema.entries,
    ...entries,
  }) as unknown as ObjectSchema<MergedEntries<TEntries, TExtension>>;
}

/** Merge two object schemas, using entries from the right on conflicts. */
export function merge<
  const TLeft extends ObjectEntries,
  const TRight extends ObjectEntries,
>(
  left: ObjectSchema<TLeft>,
  right: ObjectSchema<TRight>,
): ObjectSchema<MergedEntries<TLeft, TRight>> {
  return extend(left, right.entries);
}

/** Create a schema that accepts one key from an object schema. */
export function keyof_<const TEntries extends ObjectEntries>(
  schema: ObjectSchema<TEntries>,
): Schema<Extract<keyof TEntries, string>> {
  const keys = new Set(Object.keys(schema.entries));
  return makeSchema("keyof", "object key", (input) => {
    if (typeof input === "string" && keys.has(input)) {
      return input as Extract<keyof TEntries, string>;
    }
    return fail("keyof", "object key", input);
  });
}

/** Create a schema that parses each item in an array. */
export function array<const TItem extends Schema<unknown, unknown>>(
  item: TItem,
): ArraySchema<TItem> {
  const runSafely = (input: unknown): InternalResult<InferOutput<TItem>[]> => {
    if (!Array.isArray(input)) {
      return failureResult("array", "array", input);
    }
    const output: InferOutput<TItem>[] = [];
    let issues: Issue[] | undefined;
    for (let index = 0; index < input.length; index++) {
      const result = item["~safe"](input[index]);
      if (result.success) {
        output[index] = result.output as InferOutput<TItem>;
      } else {
        appendIssues((issues ??= []), result.issues, index);
      }
    }
    return issues
      ? { issues, output: undefined, success: false }
      : { issues: undefined, output, success: true };
  };
  const schema = new SyncSchemaNode<InferInput<TItem>[], InferOutput<TItem>[]>(
    "array",
    "array",
    (input) => {
      if (!Array.isArray(input)) {
        return fail("array", "array", input);
      }
      const output: InferOutput<TItem>[] = [];
      let issues: Issue[] | undefined;
      for (let index = 0; index < input.length; index++) {
        try {
          output[index] = item["~run"](input[index]) as InferOutput<TItem>;
        } catch (error) {
          if (!(error instanceof ValidationError)) {
            throw error;
          }
          appendIssues((issues ??= []), error.issues, index);
        }
      }
      if (issues) {
        throw new ValidationError(issues);
      }
      return output;
    },
    runSafely,
  ) as Mutable<ArraySchema<TItem>>;
  schema.item = item;
  return schema;
}

/** Build an async array schema. */
export function arrayAsync<const TItem extends GenericSchema<unknown, unknown>>(
  item: TItem,
): AsyncArraySchema<TItem> {
  return schemaProperty(
    makeAsyncSchema<InferInput<TItem>[], InferOutput<TItem>[]>(
      "array",
      "array",
      async (input) => {
        if (!Array.isArray(input)) {
          return fail("array", "array", input);
        }
        const output = new Array<InferOutput<TItem>>(input.length);
        const issues: Issue[] = [];
        for (let index = 0; index < input.length; index += 1) {
          try {
            output[index] = (await item["~run"](
              input[index],
            )) as InferOutput<TItem>;
          } catch (error) {
            if (!(error instanceof ValidationError)) {
              throw error;
            }
            appendIssues(issues, error.issues, index);
          }
        }
        if (issues.length > 0) {
          throw new ValidationError(issues);
        }
        return output;
      },
    ),
    "item",
    item,
  );
}

/** Create a fixed-length tuple schema. */
export function tuple<const TItems extends TupleItems>(
  items: TItems,
): TupleSchema<TItems> {
  return schemaProperty(
    makeSchema<TupleInput<TItems>, TupleOutput<TItems>>(
      "tuple",
      "tuple",
      (input) => {
        if (!Array.isArray(input)) {
          return fail("tuple", "tuple", input);
        }
        if (input.length !== items.length) {
          return fail("tuple", `tuple with ${items.length} items`, input);
        }
        const source: unknown[] = input;
        const output: unknown[] = new Array(items.length);
        const issues: Issue[] = [];
        for (let index = 0; index < items.length; index += 1) {
          try {
            output[index] = items[index]?.["~run"](source[index]);
          } catch (error) {
            if (!(error instanceof ValidationError)) {
              throw error;
            }
            appendIssues(issues, error.issues, index);
          }
        }
        if (issues.length > 0) {
          throw new ValidationError(issues);
        }
        return output as TupleOutput<TItems>;
      },
    ),
    "items",
    items,
  );
}

/** Create a fixed tuple schema that awaits sync or async item schemas. */
export function tupleAsync<const TItems extends GenericTupleItems>(
  items: TItems,
): AsyncSchema<GenericTupleInput<TItems>, GenericTupleOutput<TItems>> {
  return makeAsyncSchema("tuple", "tuple", async (input) => {
    if (!Array.isArray(input)) {
      return fail("tuple", "tuple", input);
    }
    if (input.length !== items.length) {
      return fail("tuple", `tuple with ${items.length} items`, input);
    }
    const output = new Array<unknown>(items.length);
    const issues: Issue[] = [];
    for (let index = 0; index < items.length; index += 1) {
      try {
        output[index] = await items[index]?.["~run"](input[index]);
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw error;
        }
        appendIssues(issues, error.issues, index);
      }
    }
    if (issues.length > 0) {
      throw new ValidationError(issues);
    }
    return output as GenericTupleOutput<TItems>;
  });
}

/** Create an async tuple schema with trailing rest items. */
export function tupleWithRestAsync<
  const TItems extends GenericTupleItems,
  const TRest extends GenericSchema<unknown, unknown>,
>(
  items: TItems,
  rest: TRest,
): AsyncSchema<
  [...GenericTupleInput<TItems>, ...InferInput<TRest>[]],
  [...GenericTupleOutput<TItems>, ...InferOutput<TRest>[]]
> {
  return makeAsyncSchema("tuple_with_rest", "tuple", async (input) => {
    if (!Array.isArray(input)) {
      return fail("tuple_with_rest", "tuple", input);
    }
    if (input.length < items.length) {
      return fail(
        "tuple_with_rest",
        `tuple with at least ${items.length} items`,
        input,
      );
    }
    const output = new Array<unknown>(input.length);
    for (let index = 0; index < input.length; index += 1) {
      try {
        const schema = index < items.length ? items[index] : rest;
        output[index] = await schema?.["~run"](input[index]);
      } catch (error) {
        prependPath(error, index);
      }
    }
    return output as [...GenericTupleOutput<TItems>, ...InferOutput<TRest>[]];
  });
}

/** Create a tuple schema with any number of trailing rest items. */
export function tupleWithRest<
  const TItems extends TupleItems,
  const TRest extends Schema<unknown, unknown>,
>(
  items: TItems,
  rest: TRest,
): Schema<
  TupleWithRestInput<TItems, TRest>,
  TupleWithRestOutput<TItems, TRest>
> & {
  readonly items: TItems;
  readonly rest: TRest;
} {
  return schemaProperty(
    schemaProperty(
      makeSchema<
        TupleWithRestInput<TItems, TRest>,
        TupleWithRestOutput<TItems, TRest>
      >("tuple_with_rest", "tuple", (input) => {
        if (!Array.isArray(input)) {
          return fail("tuple_with_rest", "tuple", input);
        }
        if (input.length < items.length) {
          return fail(
            "tuple_with_rest",
            `tuple with at least ${items.length} items`,
            input,
          );
        }
        const output = new Array<unknown>(input.length);
        let index = 0;
        try {
          for (; index < items.length; index += 1) {
            output[index] = items[index]?.["~run"](input[index]);
          }
          for (; index < input.length; index += 1) {
            output[index] = rest["~run"](input[index]);
          }
        } catch (error) {
          prependPath(error, index);
        }
        return output as TupleWithRestOutput<TItems, TRest>;
      }),
      "items",
      items,
    ),
    "rest",
    rest,
  );
}

/** Create a schema for object keys and values of one shape. */
export function record<
  const TKey extends Schema<PropertyKey, PropertyKey>,
  const TValue extends Schema<unknown, unknown>,
>(
  key: TKey,
  value: TValue,
): Schema<
  RecordOutput<InferInput<TKey>, InferInput<TValue>>,
  RecordOutput<InferOutput<TKey>, InferOutput<TValue>>
> & {
  readonly key: TKey;
  readonly value: TValue;
} {
  return schemaProperty(
    schemaProperty(
      makeSchema<
        RecordOutput<InferInput<TKey>, InferInput<TValue>>,
        RecordOutput<InferOutput<TKey>, InferOutput<TValue>>
      >("record", "record", (input) => {
        if (
          input === null ||
          typeof input !== "object" ||
          Array.isArray(input)
        ) {
          return fail("record", "record", input);
        }
        const source = input as Record<string, unknown>;
        const output: Record<PropertyKey, unknown> = {};
        let inputKey = "";
        try {
          for (inputKey of Object.keys(source)) {
            const outputKey = key["~run"](inputKey);
            setObjectProperty(
              output,
              outputKey,
              value["~run"](source[inputKey]),
            );
          }
        } catch (error) {
          prependPath(error, inputKey);
        }
        return output as RecordOutput<InferOutput<TKey>, InferOutput<TValue>>;
      }),
      "key",
      key,
    ),
    "value",
    value,
  );
}

/** Create an async schema for object keys and values of one shape. */
export function recordAsync<
  const TKey extends GenericSchema<PropertyKey, PropertyKey>,
  const TValue extends GenericSchema<unknown, unknown>,
>(
  key: TKey,
  value: TValue,
): AsyncSchema<
  RecordOutput<InferInput<TKey>, InferInput<TValue>>,
  RecordOutput<InferOutput<TKey>, InferOutput<TValue>>
> {
  return makeAsyncSchema("record", "record", async (input) => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return fail("record", "record", input);
    }
    const source = input as Record<string, unknown>;
    const output: Record<PropertyKey, unknown> = {};
    for (const inputKey of Object.keys(source)) {
      try {
        const outputKey = await key["~run"](inputKey);
        setObjectProperty(
          output,
          outputKey,
          await value["~run"](source[inputKey]),
        );
      } catch (error) {
        prependPath(error, inputKey);
      }
    }
    return output as RecordOutput<InferOutput<TKey>, InferOutput<TValue>>;
  });
}

/** Create a schema that parses every key and value in a Map. */
export function map<
  const TKey extends Schema<unknown, unknown>,
  const TValue extends Schema<unknown, unknown>,
>(
  key: TKey,
  value: TValue,
): Schema<
  Map<InferInput<TKey>, InferInput<TValue>>,
  Map<InferOutput<TKey>, InferOutput<TValue>>
> {
  return makeSchema("map", "Map", (input) => {
    if (!(input instanceof Map)) {
      return fail("map", "Map", input);
    }
    const output = new Map<InferOutput<TKey>, InferOutput<TValue>>();
    let index = 0;
    try {
      for (const [inputKey, inputValue] of input) {
        output.set(
          key["~run"](inputKey) as InferOutput<TKey>,
          value["~run"](inputValue) as InferOutput<TValue>,
        );
        index += 1;
      }
    } catch (error) {
      prependPath(error, index);
    }
    return output;
  });
}

/** Create a schema that parses every item in a Set. */
export function set<const TItem extends Schema<unknown, unknown>>(
  item: TItem,
): Schema<Set<InferInput<TItem>>, Set<InferOutput<TItem>>> & {
  readonly item: TItem;
} {
  return schemaProperty(
    makeSchema<Set<InferInput<TItem>>, Set<InferOutput<TItem>>>(
      "set",
      "Set",
      (input) => {
        if (!(input instanceof Set)) {
          return fail("set", "Set", input);
        }
        const output = new Set<InferOutput<TItem>>();
        let index = 0;
        try {
          for (const inputItem of input) {
            output.add(item["~run"](inputItem) as InferOutput<TItem>);
            index += 1;
          }
        } catch (error) {
          prependPath(error, index);
        }
        return output;
      },
    ),
    "item",
    item,
  );
}

/** Create an async schema that parses every key and value in a Map. */
export function mapAsync<
  const TKey extends GenericSchema<unknown, unknown>,
  const TValue extends GenericSchema<unknown, unknown>,
>(
  key: TKey,
  value: TValue,
): AsyncSchema<
  Map<InferInput<TKey>, InferInput<TValue>>,
  Map<InferOutput<TKey>, InferOutput<TValue>>
> {
  return makeAsyncSchema("map", "Map", async (input) => {
    if (!(input instanceof Map)) {
      return fail("map", "Map", input);
    }
    const output = new Map<InferOutput<TKey>, InferOutput<TValue>>();
    let index = 0;
    for (const [inputKey, inputValue] of input) {
      try {
        output.set(
          (await key["~run"](inputKey)) as InferOutput<TKey>,
          (await value["~run"](inputValue)) as InferOutput<TValue>,
        );
      } catch (error) {
        prependPath(error, index);
      }
      index += 1;
    }
    return output;
  });
}

/** Create an async schema that parses every item in a Set. */
export function setAsync<const TItem extends GenericSchema<unknown, unknown>>(
  item: TItem,
): AsyncSchema<Set<InferInput<TItem>>, Set<InferOutput<TItem>>> {
  return makeAsyncSchema("set", "Set", async (input) => {
    if (!(input instanceof Set)) {
      return fail("set", "Set", input);
    }
    const output = new Set<InferOutput<TItem>>();
    let index = 0;
    for (const inputItem of input) {
      try {
        output.add((await item["~run"](inputItem)) as InferOutput<TItem>);
      } catch (error) {
        prependPath(error, index);
      }
      index += 1;
    }
    return output;
  });
}

/** Create a schema that validates calls to a function. */
export function function_<
  const TArguments extends TupleItems,
  const TReturn extends Schema<unknown, unknown>,
>(
  arguments_: TArguments,
  return_: TReturn,
): Schema<
  FunctionInput<TArguments, TReturn>,
  FunctionOutput<TArguments, TReturn>
> {
  const argumentsSchema = tuple(arguments_);
  return makeSchema("function", "function", (input) => {
    if (typeof input !== "function") {
      return fail("function", "function", input);
    }
    const operation = input as (
      ...arguments_: TupleInput<TArguments>
    ) => unknown;
    return (...callArguments: TupleInput<TArguments>): InferOutput<TReturn> => {
      const parsedArguments = argumentsSchema["~run"](callArguments);
      return return_["~run"](operation(...parsedArguments));
    };
  });
}

/** Create an async schema that validates function calls and results. */
export function functionAsync<
  const TArguments extends GenericTupleItems,
  const TReturn extends GenericSchema<unknown, unknown>,
>(
  arguments_: TArguments,
  return_: TReturn,
): AsyncSchema<
  (
    ...arguments_: GenericTupleInput<TArguments>
  ) => InferInput<TReturn> | PromiseLike<InferInput<TReturn>>,
  (
    ...arguments_: GenericTupleInput<TArguments>
  ) => Promise<InferOutput<TReturn>>
> {
  const argumentsSchema = tupleAsync(arguments_);
  return makeAsyncSchema("function", "function", async (input) => {
    if (typeof input !== "function") {
      return fail("function", "function", input);
    }
    const operation = input as (
      ...arguments_: GenericTupleInput<TArguments>
    ) => unknown;
    return async (
      ...callArguments: GenericTupleInput<TArguments>
    ): Promise<InferOutput<TReturn>> => {
      const parsedArguments = await argumentsSchema["~run"](callArguments);
      return await return_["~run"](await operation(...parsedArguments));
    };
  });
}

/** Create a schema that validates a promise's resolved value. */
export function promise<const TItem extends Schema<unknown, unknown>>(
  item: TItem,
): Schema<PromiseLike<InferInput<TItem>>, Promise<InferOutput<TItem>>> {
  return makeSchema("promise", "Promise", (input) => {
    if (
      (typeof input !== "object" && typeof input !== "function") ||
      input === null ||
      !("then" in input) ||
      typeof input.then !== "function"
    ) {
      return fail("promise", "Promise", input);
    }
    return Promise.resolve(input).then((value) =>
      item["~run"](value),
    ) as Promise<InferOutput<TItem>>;
  });
}

/** Create a bidirectional schema from encoded and decoded schemas. */
export function codec<
  const TEncoded extends Schema<unknown, unknown>,
  const TDecoded extends Schema<unknown, unknown>,
>(
  encoded: TEncoded,
  decoded: TDecoded,
  decode_: (input: InferOutput<TEncoded>) => InferInput<TDecoded>,
  encode_: (output: InferOutput<TDecoded>) => InferInput<TEncoded>,
): CodecSchema<TEncoded, TDecoded> {
  return schemaProperty(
    schemaProperty(
      schemaProperty(
        makeSchema<InferInput<TEncoded>, InferOutput<TDecoded>>(
          "codec",
          encoded.expects,
          (input) => decoded["~run"](decode_(encoded["~run"](input))),
        ),
        "decoded",
        decoded,
      ),
      "encoded",
      encoded,
    ),
    "~encode",
    (output: InferOutput<TDecoded>) =>
      encoded["~run"](
        encode_(decoded["~run"](output)),
      ) as InferOutput<TEncoded>,
  );
}

/** Decode an external value through a codec. */
export function decode<
  const TEncoded extends Schema<unknown, unknown>,
  const TDecoded extends Schema<unknown, unknown>,
>(
  schema: CodecSchema<TEncoded, TDecoded>,
  input: unknown,
): InferOutput<TDecoded> {
  return schema["~run"](input);
}

/** Encode a decoded value through a codec. */
export function encode<
  const TEncoded extends Schema<unknown, unknown>,
  const TDecoded extends Schema<unknown, unknown>,
>(
  schema: CodecSchema<TEncoded, TDecoded>,
  output: InferOutput<TDecoded>,
): InferOutput<TEncoded> {
  return schema["~encode"](output);
}

/** Create an async bidirectional schema. */
export function codecAsync<
  const TEncoded extends GenericSchema<unknown, unknown>,
  const TDecoded extends GenericSchema<unknown, unknown>,
>(
  encoded: TEncoded,
  decoded: TDecoded,
  decode_: (input: InferOutput<TEncoded>) => Promise<InferInput<TDecoded>>,
  encode_: (output: InferOutput<TDecoded>) => Promise<InferInput<TEncoded>>,
): AsyncCodecSchema<TEncoded, TDecoded> {
  return schemaProperty(
    schemaProperty(
      schemaProperty(
        makeAsyncSchema<InferInput<TEncoded>, InferOutput<TDecoded>>(
          "codec",
          encoded.expects,
          async (input) =>
            await decoded["~run"](await decode_(await encoded["~run"](input))),
        ),
        "decoded",
        decoded,
      ),
      "encoded",
      encoded,
    ),
    "~encode",
    async (output: InferOutput<TDecoded>) =>
      await encoded["~run"](await encode_(await decoded["~run"](output))),
  );
}

/** Decode an external value through an async codec. */
export async function decodeAsync<
  const TEncoded extends GenericSchema<unknown, unknown>,
  const TDecoded extends GenericSchema<unknown, unknown>,
>(
  schema: AsyncCodecSchema<TEncoded, TDecoded>,
  input: unknown,
): Promise<InferOutput<TDecoded>> {
  return await schema["~run"](input);
}

/** Encode a decoded value through an async codec. */
export async function encodeAsync<
  const TEncoded extends GenericSchema<unknown, unknown>,
  const TDecoded extends GenericSchema<unknown, unknown>,
>(
  schema: AsyncCodecSchema<TEncoded, TDecoded>,
  output: InferOutput<TDecoded>,
): Promise<InferOutput<TEncoded>> {
  return await schema["~encode"](output);
}

/** Return whether a cheap type check can rule out a schema option. */
function quicklyRejects(
  schema: GenericSchema<unknown, unknown>,
  input: unknown,
): boolean {
  if ("literal" in schema) {
    return input !== schema.literal;
  }
  switch (schema.type) {
    case "array":
    case "tuple":
    case "tuple_with_rest":
      return !Array.isArray(input);
    case "bigint":
    case "boolean":
    case "string":
    case "symbol":
      return typeof input !== schema.type;
    case "null":
      return input !== null;
    case "number":
      return typeof input !== "number" || input !== input;
    case "object":
    case "strict_object":
    case "loose_object":
    case "record":
    case "variant":
      return (
        input === null || typeof input !== "object" || Array.isArray(input)
      );
    case "undefined":
    case "void":
      return input !== undefined;
    default:
      return false;
  }
}

/** Create a schema that accepts the first matching option. */
export function union<const TOptions extends UnionOptions>(
  options: TOptions,
): UnionSchema<TOptions> {
  const numberOption = options.find((option) => option === number());
  const schema = makeSchema<
    InferInput<TOptions[number]>,
    InferOutput<TOptions[number]>
  >("union", "union", (input) => {
    if (numberOption && !quicklyRejects(numberOption, input)) {
      return input as InferOutput<TOptions[number]>;
    }
    const subIssues: Issue[] = [];
    for (const option of options) {
      if (quicklyRejects(option, input)) {
        continue;
      }
      try {
        return option["~run"](input) as InferOutput<TOptions[number]>;
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw error;
        }
        subIssues.push(...error.issues);
      }
    }
    for (const option of options) {
      if (quicklyRejects(option, input)) {
        subIssues.push(makeIssue(option.type, option.expects, input));
      }
    }
    throw new ValidationError([
      {
        ...makeIssue("union", "union", input),
        issues: subIssues,
      },
    ]);
  }) as Mutable<UnionSchema<TOptions>>;
  schema.options = options;
  return schema;
}

/** Create an async union from sync or async options. */
export function unionAsync<const TOptions extends GenericUnionOptions>(
  options: TOptions,
): AsyncSchema<InferInput<TOptions[number]>, InferOutput<TOptions[number]>> {
  return makeAsyncSchema("union", "union", async (input) => {
    const subIssues: Issue[] = [];
    for (const option of options) {
      if (quicklyRejects(option, input)) {
        continue;
      }
      try {
        return (await option["~run"](input)) as InferOutput<TOptions[number]>;
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw error;
        }
        subIssues.push(...error.issues);
      }
    }
    for (const option of options) {
      if (quicklyRejects(option, input)) {
        subIssues.push(
          ...failureResult(option.type, option.expects, input).issues,
        );
      }
    }
    throw new ValidationError([
      {
        ...makeIssue("union", "union", input),
        issues: subIssues,
      },
    ]);
  });
}

/** Create an object union selected by one literal discriminator key. */
export function variant<
  const TDiscriminator extends string,
  const TOptions extends VariantOptions,
>(discriminator: TDiscriminator, options: TOptions): VariantSchema<TOptions> {
  const optionByValue = new Map<Literal, ObjectSchema<ObjectEntries>>();
  for (const option of options) {
    const entry = option.entries[discriminator];
    if (!entry || !hasLiteral(entry)) {
      throw new TypeError(
        `Variant option must contain a literal "${discriminator}" entry`,
      );
    }
    optionByValue.set(entry.literal, option);
  }
  return schemaProperty(
    schemaProperty(
      makeSchema<InferInput<TOptions[number]>, InferOutput<TOptions[number]>>(
        "variant",
        "variant object",
        (input) => {
          if (
            input === null ||
            typeof input !== "object" ||
            Array.isArray(input)
          ) {
            return fail("variant", "variant object", input);
          }
          const value = (input as Record<string, unknown>)[discriminator];
          const option = optionByValue.get(value as Literal);
          if (!option) {
            return fail("variant", `${discriminator} discriminator`, input);
          }
          return option["~run"](input) as InferOutput<TOptions[number]>;
        },
      ),
      "discriminator",
      discriminator,
    ),
    "options",
    options,
  );
}

/** Create an async object union selected by one literal discriminator key. */
export function variantAsync<
  const TDiscriminator extends string,
  const TOptions extends GenericVariantOptions,
>(
  discriminator: TDiscriminator,
  options: TOptions,
): AsyncSchema<InferInput<TOptions[number]>, InferOutput<TOptions[number]>> {
  const optionByValue = new Map<Literal, GenericVariantOption>();
  for (const option of options) {
    const entry = option.entries[discriminator];
    if (!entry || !("literal" in entry)) {
      throw new TypeError(
        `Variant option must contain a literal "${discriminator}" entry`,
      );
    }
    optionByValue.set(entry.literal as Literal, option);
  }
  return makeAsyncSchema("variant", "variant object", async (input) => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return fail("variant", "variant object", input);
    }
    const value = (input as Record<string, unknown>)[discriminator];
    const option = optionByValue.get(value as Literal);
    if (!option) {
      return fail("variant", `${discriminator} discriminator`, input);
    }
    return (await option["~run"](input)) as InferOutput<TOptions[number]>;
  });
}

/** Create a lazily resolved schema for recursive definitions. */
export function lazy<const TSchema extends Schema<unknown, unknown>>(
  getter: () => TSchema,
): LazySchema<InferInput<TSchema>, InferOutput<TSchema>, TSchema> {
  let resolved: TSchema | undefined;
  let resolvedRun: ((input: unknown) => InferOutput<TSchema>) | undefined;
  const getSchema = (): TSchema => {
    resolved ??= getter();
    return resolved;
  };
  return schemaProperty(
    makeSchema<InferInput<TSchema>, InferOutput<TSchema>>(
      "lazy",
      "lazy value",
      (input) => (resolvedRun ??= getSchema()["~run"])(input),
    ),
    "getSchema",
    getSchema,
  );
}

/** Create an asynchronously resolved lazy schema. */
export function lazyAsync<TInput, TOutput = TInput>(
  getter: () =>
    | GenericSchema<TInput, TOutput>
    | Promise<GenericSchema<TInput, TOutput>>,
): AsyncSchema<TInput, TOutput> {
  let resolved: GenericSchema<TInput, TOutput> | undefined;
  return makeAsyncSchema("lazy", "lazy value", async (input) => {
    resolved ??= await getter();
    return await resolved["~run"](input);
  });
}

/** Merge compatible intersection outputs without flattening class instances. */
function mergeIntersectionOutputs(
  first: unknown,
  second: unknown,
  input: unknown,
): unknown {
  if (Object.is(first, second)) {
    return first;
  }
  if (
    first instanceof Date &&
    second instanceof Date &&
    first.getTime() === second.getTime()
  ) {
    return first;
  }
  if (Array.isArray(first) && Array.isArray(second)) {
    if (first.length !== second.length) {
      return fail("intersect", "compatible intersection outputs", input);
    }
    return first.map((value, index) =>
      mergeIntersectionOutputs(value, second[index], input),
    );
  }
  if (
    first !== null &&
    second !== null &&
    typeof first === "object" &&
    typeof second === "object" &&
    Object.getPrototypeOf(first) === Object.prototype &&
    Object.getPrototypeOf(second) === Object.prototype
  ) {
    const output: Record<PropertyKey, unknown> = {
      ...(first as Record<PropertyKey, unknown>),
    };
    for (const key of Object.keys(second)) {
      setObjectProperty(
        output,
        key,
        Object.hasOwn(first, key)
          ? mergeIntersectionOutputs(
              (first as Record<PropertyKey, unknown>)[key],
              (second as Record<PropertyKey, unknown>)[key],
              input,
            )
          : (second as Record<PropertyKey, unknown>)[key],
      );
    }
    return output;
  }
  return fail("intersect", "compatible intersection outputs", input);
}

/** Create a schema that requires and merges every option. */
export function intersect<const TOptions extends IntersectOptions>(
  options: TOptions,
): Schema<
  UnionToIntersection<InferInput<TOptions[number]>>,
  UnionToIntersection<InferOutput<TOptions[number]>>
> & {
  readonly options: TOptions;
} {
  return schemaProperty(
    makeSchema<
      UnionToIntersection<InferInput<TOptions[number]>>,
      UnionToIntersection<InferOutput<TOptions[number]>>
    >("intersect", "intersection", (input) => {
      let output: unknown;
      let hasOutput = false;
      for (const option of options) {
        const parsed = option["~run"](input);
        if (!hasOutput) {
          output = parsed;
          hasOutput = true;
        } else {
          output = mergeIntersectionOutputs(output, parsed, input);
        }
      }
      return output as UnionToIntersection<InferOutput<TOptions[number]>>;
    }),
    "options",
    options,
  );
}

/** Create an async schema that requires and merges every option. */
export function intersectAsync<const TOptions extends GenericIntersectOptions>(
  options: TOptions,
): AsyncSchema<
  UnionToIntersection<InferInput<TOptions[number]>>,
  UnionToIntersection<InferOutput<TOptions[number]>>
> {
  return makeAsyncSchema("intersect", "intersection", async (input) => {
    let output: unknown;
    let hasOutput = false;
    for (const option of options) {
      const parsed = await option["~run"](input);
      if (!hasOutput) {
        output = parsed;
        hasOutput = true;
      } else {
        output = mergeIntersectionOutputs(output, parsed, input);
      }
    }
    return output as UnionToIntersection<InferOutput<TOptions[number]>>;
  });
}

/** Create an action that maps one valid value to another. */
export function transform<TInput, TOutput>(
  operation: (input: TInput) => TOutput,
): TransformationAction<TInput, TOutput> {
  return {
    kind: "transformation",
    "~run": (input) => operation(input as TInput),
  };
}

/** Create an output-preserving streaming checkpoint action. */
export function streaming(): StreamingAction {
  return {
    actionType: "streaming",
    kind: "transformation",
    streaming: true,
    "~run": (input) => input,
  };
}

/** Create an asynchronous action that maps one valid value to another. */
export function transformAsync<TInput, TOutput>(
  operation: (input: TInput) => Promise<TOutput>,
): AsyncTransformationAction<TInput, TOutput> {
  return {
    async: true,
    kind: "transformation",
    "~run": operation as (input: unknown) => Promise<TOutput>,
  };
}

/** Create an action that keeps values which meet a custom requirement. */
export function check<TInput>(
  requirement: (input: TInput) => boolean,
  message = "Invalid value",
): ValidationAction<TInput> {
  return {
    kind: "validation",
    "~run": (input) => {
      if (requirement(input as TInput)) {
        return input as TInput;
      }
      return fail("check", "valid value", input, message);
    },
  };
}

/** Create an async action that keeps values which meet a custom requirement. */
export function checkAsync<TInput>(
  requirement: (input: TInput) => Promise<boolean>,
  message = "Invalid value",
): AsyncValidationAction<TInput> {
  return {
    async: true,
    kind: "validation",
    "~run": async (input) => {
      if (await requirement(input as TInput)) {
        return input as TInput;
      }
      return fail("check", "valid value", input, message);
    },
  };
}

/** Create one compiled validation action. */
function validationAction<TInput>(
  type: string,
  expected: string,
  predicate: (input: TInput) => boolean,
  message: string,
  requirement?: unknown,
): ValidationAction<TInput> {
  return {
    actionType: type,
    kind: "validation",
    requirement,
    "~run": (input) => {
      if (predicate(input as TInput)) {
        return input as TInput;
      }
      return fail(type, expected, input, message);
    },
  };
}

/** Create an action that requires an exact string or collection length. */
export function length(
  requirement: number,
  message = `Expected exactly ${requirement} items`,
): ValidationAction<LengthInput> {
  return validationAction(
    "length",
    `length = ${requirement}`,
    (input: LengthInput) => input.length === requirement,
    message,
  );
}

/** Create an action that requires at least one string or collection item. */
export function nonEmpty(
  message = "Expected at least one item",
): ValidationAction<LengthInput> {
  return minLength(1, message);
}

/** Create an action that requires a minimum string or collection length. */
export function minLength(
  requirement: number,
  message = `Expected at least ${requirement} items`,
): ValidationAction<LengthInput> {
  return {
    actionType: "min_length",
    kind: "validation",
    requirement,
    "~run": (input) => {
      const value = input as LengthInput;
      if (value.length >= requirement) {
        return value;
      }
      return fail("min_length", `length >= ${requirement}`, input, message);
    },
  };
}

/** Create an action that requires a maximum string or collection length. */
export function maxLength(
  requirement: number,
  message = `Expected at most ${requirement} items`,
): ValidationAction<LengthInput> {
  return {
    actionType: "max_length",
    kind: "validation",
    requirement,
    "~run": (input) => {
      const value = input as LengthInput;
      if (value.length <= requirement) {
        return value;
      }
      return fail("max_length", `length <= ${requirement}`, input, message);
    },
  };
}

/** Create an action that requires a minimum Map or Set size. */
export function minSize(
  requirement: number,
  message = `Expected a size of at least ${requirement}`,
): ValidationAction<SizeInput> {
  return validationAction(
    "min_size",
    `size >= ${requirement}`,
    (input: SizeInput) => input.size >= requirement,
    message,
  );
}

/** Create an action that requires a maximum Map or Set size. */
export function maxSize(
  requirement: number,
  message = `Expected a size of at most ${requirement}`,
): ValidationAction<SizeInput> {
  return validationAction(
    "max_size",
    `size <= ${requirement}`,
    (input: SizeInput) => input.size <= requirement,
    message,
  );
}

/** Create an action that requires a minimum object entry count. */
export function minEntries(
  requirement: number,
  message = `Expected at least ${requirement} entries`,
): ValidationAction<object> {
  return validationAction(
    "min_entries",
    `entries >= ${requirement}`,
    (input: object) => Object.keys(input).length >= requirement,
    message,
  );
}

/** Create an action that requires a maximum object entry count. */
export function maxEntries(
  requirement: number,
  message = `Expected at most ${requirement} entries`,
): ValidationAction<object> {
  return validationAction(
    "max_entries",
    `entries <= ${requirement}`,
    (input: object) => Object.keys(input).length <= requirement,
    message,
  );
}

/** Count UTF-8 bytes without a platform-specific encoder. */
function utf8ByteCount(input: string): number {
  let count = 0;
  for (const character of input) {
    const codePoint = character.codePointAt(0) ?? 0;
    count +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return count;
}

/** Create an action that requires an exact UTF-8 byte count. */
export function bytes(
  requirement: number,
  message = `Expected exactly ${requirement} bytes`,
): ValidationAction<string> {
  return validationAction(
    "bytes",
    `${requirement} bytes`,
    (input: string) => utf8ByteCount(input) === requirement,
    message,
    requirement,
  );
}

/** Create an action that requires a minimum UTF-8 byte count. */
export function minBytes(
  requirement: number,
  message = `Expected at least ${requirement} bytes`,
): ValidationAction<string> {
  return validationAction(
    "min_bytes",
    `bytes >= ${requirement}`,
    (input: string) => utf8ByteCount(input) >= requirement,
    message,
    requirement,
  );
}

/** Create an action that requires a maximum UTF-8 byte count. */
export function maxBytes(
  requirement: number,
  message = `Expected at most ${requirement} bytes`,
): ValidationAction<string> {
  return validationAction(
    "max_bytes",
    `bytes <= ${requirement}`,
    (input: string) => utf8ByteCount(input) <= requirement,
    message,
    requirement,
  );
}

/** Create an action that requires an exact Unicode code-point count. */
export function graphemes(
  requirement: number,
  message = `Expected exactly ${requirement} graphemes`,
): ValidationAction<string> {
  return validationAction(
    "graphemes",
    `${requirement} graphemes`,
    (input: string) => [...input].length === requirement,
    message,
    requirement,
  );
}

/** Count whitespace-delimited words. */
function wordCount(input: string): number {
  const trimmed = input.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/** Create an action that requires an exact word count. */
export function words(
  requirement: number,
  message = `Expected exactly ${requirement} words`,
): ValidationAction<string> {
  return validationAction(
    "words",
    `${requirement} words`,
    (input: string) => wordCount(input) === requirement,
    message,
    requirement,
  );
}

/** Create an action that requires a minimum word count. */
export function minWords(
  requirement: number,
  message = `Expected at least ${requirement} words`,
): ValidationAction<string> {
  return validationAction(
    "min_words",
    `words >= ${requirement}`,
    (input: string) => wordCount(input) >= requirement,
    message,
    requirement,
  );
}

/** Create an action that requires a maximum word count. */
export function maxWords(
  requirement: number,
  message = `Expected at most ${requirement} words`,
): ValidationAction<string> {
  return validationAction(
    "max_words",
    `words <= ${requirement}`,
    (input: string) => wordCount(input) <= requirement,
    message,
    requirement,
  );
}

/** Create an action that requires an exact object entry count. */
export function entries(
  requirement: number,
  message = `Expected exactly ${requirement} entries`,
): ValidationAction<object> {
  return validationAction(
    "entries",
    `${requirement} entries`,
    (input: object) => Object.keys(input).length === requirement,
    message,
    requirement,
  );
}

/** Create an action that requires an exact Map or Set size. */
export function size(
  requirement: number,
  message = `Expected a size of ${requirement}`,
): ValidationAction<SizeInput> {
  return validationAction(
    "size",
    `size = ${requirement}`,
    (input: SizeInput) => input.size === requirement,
    message,
    requirement,
  );
}

/** Create an action that requires an empty length- or size-based value. */
export function empty(
  message = "Expected an empty value",
): ValidationAction<LengthInput | SizeInput> {
  return validationAction(
    "empty",
    "empty value",
    (input: LengthInput | SizeInput) => {
      const value = input as {
        readonly length?: number;
        readonly size?: number;
      };
      return (value.length ?? value.size) === 0;
    },
    message,
  );
}

/** Create an action that trims leading and trailing whitespace. */
export function trim(): TransformationAction<string, string> {
  return transform((input: string) => input.trim());
}

/** Create an action that trims leading whitespace. */
export function trimStart(): TransformationAction<string, string> {
  return transform((input: string) => input.trimStart());
}

/** Create an action that trims trailing whitespace. */
export function trimEnd(): TransformationAction<string, string> {
  return transform((input: string) => input.trimEnd());
}

/** Create an action that normalizes Unicode text. */
export function normalize(
  form: "NFC" | "NFD" | "NFKC" | "NFKD" = "NFC",
): TransformationAction<string, string> {
  return transform((input: string) => input.normalize(form));
}

/** Create an action that replaces matching string content. */
export function replace(
  searchValue: string | RegExp,
  replaceValue: string,
): TransformationAction<string, string> {
  return transform((input: string) => input.replace(searchValue, replaceValue));
}

/** Create an action that requires a string prefix. */
export function startsWith(
  requirement: string,
  message = `Expected a string starting with ${JSON.stringify(requirement)}`,
): ValidationAction<string> {
  return validationAction(
    "starts_with",
    `prefix ${JSON.stringify(requirement)}`,
    (input: string) => input.startsWith(requirement),
    message,
  );
}

/** Create an action that requires a string suffix. */
export function endsWith(
  requirement: string,
  message = `Expected a string ending with ${JSON.stringify(requirement)}`,
): ValidationAction<string> {
  return validationAction(
    "ends_with",
    `suffix ${JSON.stringify(requirement)}`,
    (input: string) => input.endsWith(requirement),
    message,
  );
}

/** Create an action that requires a string fragment. */
export function includes(
  requirement: string,
  message = `Expected a string containing ${JSON.stringify(requirement)}`,
): ValidationAction<string> {
  return validationAction(
    "includes",
    `fragment ${JSON.stringify(requirement)}`,
    (input: string) => input.includes(requirement),
    message,
  );
}

/** Create an action that requires lowercase text. */
export function lowercase(
  message = "Expected a lowercase string",
): ValidationAction<string> {
  return validationAction(
    "lowercase",
    "lowercase string",
    (input: string) => input === input.toLowerCase(),
    message,
  );
}

/** Create an action that requires uppercase text. */
export function uppercase(
  message = "Expected an uppercase string",
): ValidationAction<string> {
  return validationAction(
    "uppercase",
    "uppercase string",
    (input: string) => input === input.toUpperCase(),
    message,
  );
}

/** Create an action that lowercases text. */
export function toLowerCase(): TransformationAction<string, string> {
  return transform((input: string) => input.toLowerCase());
}

/** Create an action that uppercases text. */
export function toUpperCase(): TransformationAction<string, string> {
  return transform((input: string) => input.toUpperCase());
}

/** Create an action that requires a string to match a regular expression. */
export function regex(
  requirement: RegExp,
  message = `Expected a string matching ${requirement}`,
): ValidationAction<string> {
  return {
    actionType: "regex",
    kind: "validation",
    requirement,
    "~run": (input) => {
      const value = input as string;
      requirement.lastIndex = 0;
      const matches = requirement.test(value);
      requirement.lastIndex = 0;
      if (matches) {
        return value;
      }
      return fail("regex", String(requirement), input, message);
    },
  };
}

/** Create an action that requires a practical email address shape. */
export function email(
  message = "Expected an email address",
): ValidationAction<string> {
  return {
    kind: "validation",
    "~run": (input) => {
      const value = input as string;
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return value;
      }
      return fail("email", "email address", input, message);
    },
  };
}

/** Create one regular-expression-backed string format action. */
function stringFormat(
  type: string,
  expected: string,
  pattern: RegExp,
  message: string,
): ValidationAction<string> {
  return validationAction(
    type,
    expected,
    (input: string) => pattern.test(input),
    message,
    pattern,
  );
}

/** Create an action that requires canonical Base64 text. */
export function base64(
  message = "Expected Base64 text",
): ValidationAction<string> {
  return stringFormat(
    "base64",
    "Base64 text",
    /^(?:[\dA-Za-z+/]{4})*(?:[\dA-Za-z+/]{2}==|[\dA-Za-z+/]{3}=)?$/,
    message,
  );
}

/** Create an action that requires a Cuid2 identifier. */
export function cuid2(message = "Expected a Cuid2"): ValidationAction<string> {
  return stringFormat("cuid2", "Cuid2", /^[a-z][a-z\d]{23,31}$/, message);
}

/** Create an action that requires plain decimal notation. */
export function decimal(
  message = "Expected a decimal number",
): ValidationAction<string> {
  return stringFormat(
    "decimal",
    "decimal number",
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/,
    message,
  );
}

/** Create an action that requires decimal digits. */
export function digits(message = "Expected digits"): ValidationAction<string> {
  return stringFormat("digits", "digits", /^\d+$/, message);
}

/** Create an action that requires a DNS domain name. */
export function domain(
  message = "Expected a domain name",
): ValidationAction<string> {
  return stringFormat(
    "domain",
    "domain name",
    /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/i,
    message,
  );
}

/** Create an action that requires emoji text. */
export function emoji(message = "Expected emoji"): ValidationAction<string> {
  return stringFormat(
    "emoji",
    "emoji",
    /^(?:\p{Extended_Pictographic}\uFE0F?)+$/u,
    message,
  );
}

/** Create an action that requires a CSS hexadecimal color. */
export function hexColor(
  message = "Expected a hexadecimal color",
): ValidationAction<string> {
  return stringFormat(
    "hex_color",
    "hexadecimal color",
    /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i,
    message,
  );
}

/** Create an action that requires hexadecimal digits. */
export function hexadecimal(
  message = "Expected hexadecimal digits",
): ValidationAction<string> {
  return stringFormat(
    "hexadecimal",
    "hexadecimal digits",
    /^[\da-f]+$/i,
    message,
  );
}

/** Return whether text is an IPv4 address. */
function isIpv4(input: string): boolean {
  const parts = input.split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255,
    )
  );
}

/** Return whether text is an IPv6 address. */
function isIpv6(input: string): boolean {
  const halves = input.split("::");
  if (halves.length > 2) {
    return false;
  }
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (![...left, ...right].every((part) => /^[\da-f]{1,4}$/i.test(part))) {
    return false;
  }
  return halves.length === 2
    ? left.length + right.length < 8
    : left.length === 8;
}

/** Create an action that requires an IPv4 address. */
export function ipv4(
  message = "Expected an IPv4 address",
): ValidationAction<string> {
  return validationAction("ipv4", "IPv4 address", isIpv4, message);
}

/** Create an action that requires an IPv6 address. */
export function ipv6(
  message = "Expected an IPv6 address",
): ValidationAction<string> {
  return validationAction("ipv6", "IPv6 address", isIpv6, message);
}

/** Create an action that requires an IPv4 or IPv6 address. */
export function ip(
  message = "Expected an IP address",
): ValidationAction<string> {
  return validationAction(
    "ip",
    "IP address",
    (input: string) => isIpv4(input) || isIpv6(input),
    message,
  );
}

/** Return whether text is a valid clock time. */
function isIsoTime(input: string): boolean {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/.exec(input);
  return (
    match !== null &&
    Number(match[1]) <= 23 &&
    Number(match[2]) <= 59 &&
    (match[3] === undefined || Number(match[3]) <= 59)
  );
}

/** Create an action that requires an ISO date-time. */
export function isoDateTime(
  message = "Expected an ISO date-time",
): ValidationAction<string> {
  return validationAction(
    "iso_date_time",
    "ISO date-time",
    (input: string) =>
      /^\d{4}-\d{2}-\d{2}T/.test(input) && !Number.isNaN(Date.parse(input)),
    message,
  );
}

/** Create an action that requires an ISO clock time. */
export function isoTime(
  message = "Expected an ISO time",
): ValidationAction<string> {
  return validationAction("iso_time", "ISO time", isIsoTime, message);
}

/** Create an action that requires an ISO timestamp with a timezone. */
export function isoTimestamp(
  message = "Expected an ISO timestamp",
): ValidationAction<string> {
  return validationAction(
    "iso_timestamp",
    "ISO timestamp",
    (input: string) =>
      /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input) &&
      !Number.isNaN(Date.parse(input)),
    message,
  );
}

/** Create an action that requires an ISO week. */
export function isoWeek(
  message = "Expected an ISO week",
): ValidationAction<string> {
  return stringFormat(
    "iso_week",
    "ISO week",
    /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/,
    message,
  );
}

/** Create an action that requires a MAC-48 or MAC-64 address. */
export function mac(
  message = "Expected a MAC address",
): ValidationAction<string> {
  return stringFormat(
    "mac",
    "MAC address",
    /^(?:[\da-f]{2}[:-]){5}(?:[\da-f]{2})$|^(?:[\da-f]{2}[:-]){7}(?:[\da-f]{2})$/i,
    message,
  );
}

/** Create an action that requires a 21-character Nano ID. */
export function nanoid(
  message = "Expected a Nano ID",
): ValidationAction<string> {
  return stringFormat("nanoid", "Nano ID", /^[\w-]{21}$/, message);
}

/** Create an action that requires octal digits. */
export function octal(
  message = "Expected octal digits",
): ValidationAction<string> {
  return stringFormat("octal", "octal digits", /^[0-7]+$/, message);
}

/** Create an action that requires an RFC-style email address. */
export function rfcEmail(
  message = "Expected an RFC email address",
): ValidationAction<string> {
  return stringFormat(
    "rfc_email",
    "RFC email address",
    /^[.!#$%&'*+/=?^_`{|}~\w-]+@(?:[\da-z](?:[\da-z-]{0,61}[\da-z])?\.)+[\da-z]{2,63}$/i,
    message,
  );
}

/** Create an action that requires a lowercase URL slug. */
export function slug(message = "Expected a slug"): ValidationAction<string> {
  return stringFormat("slug", "slug", /^[a-z\d]+(?:-[a-z\d]+)*$/, message);
}

/** Create an action that requires a ULID. */
export function ulid(message = "Expected a ULID"): ValidationAction<string> {
  return stringFormat("ulid", "ULID", /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, message);
}

/** Create an action that validates a payment-card Luhn checksum. */
export function creditCard(
  message = "Expected a credit card number",
): ValidationAction<string> {
  return validationAction(
    "credit_card",
    "credit card number",
    (input: string) => {
      const digitsOnly = input.replace(/[\s-]/g, "");
      if (!/^\d{12,19}$/.test(digitsOnly)) {
        return false;
      }
      let sum = 0;
      let double = false;
      for (let index = digitsOnly.length - 1; index >= 0; index -= 1) {
        let digit = Number(digitsOnly[index]);
        if (double) {
          digit *= 2;
          if (digit > 9) {
            digit -= 9;
          }
        }
        sum += digit;
        double = !double;
      }
      return sum % 10 === 0;
    },
    message,
  );
}

/** Create an action that requires an absolute URL. */
export function url(message = "Expected a URL"): ValidationAction<string> {
  return validationAction(
    "url",
    "URL",
    (input: string) => /^[a-z][a-z\d+.-]*:\/\/[^\s]+$/i.test(input),
    message,
  );
}

/** Create an action that requires an RFC 9562 UUID string. */
export function uuid(message = "Expected a UUID"): ValidationAction<string> {
  return validationAction(
    "uuid",
    "UUID",
    (input: string) =>
      /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(input),
    message,
  );
}

/** Create an action that requires a real ISO 8601 calendar date. */
export function isoDate(
  message = "Expected an ISO date",
): ValidationAction<string> {
  return validationAction(
    "iso_date",
    "ISO date",
    (input: string) => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
      if (!match) {
        return false;
      }
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (month < 1 || month > 12 || day < 1) {
        return false;
      }
      const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days =
        month === 2
          ? leapYear
            ? 29
            : 28
          : month === 4 || month === 6 || month === 9 || month === 11
            ? 30
            : 31;
      return day <= days;
    },
    message,
  );
}

/** Create an action that requires an integer. */
export function integer(
  message = "Expected an integer",
): ValidationAction<number> {
  return {
    actionType: "integer",
    kind: "validation",
    "~run": (input) => {
      const value = input as number;
      if (Number.isInteger(value)) {
        return value;
      }
      return fail("integer", "integer", input, message);
    },
  };
}

/** Create an action that requires a safe integer. */
export function safeInteger(
  message = "Expected a safe integer",
): ValidationAction<number> {
  return validationAction(
    "safe_integer",
    "safe integer",
    (input: number) => Number.isSafeInteger(input),
    message,
  );
}

/** Create an action that requires a finite number. */
export function finite(
  message = "Expected a finite number",
): ValidationAction<number> {
  return validationAction(
    "finite",
    "finite number",
    (input: number) => Number.isFinite(input),
    message,
  );
}

/** Return whether a number is a multiple within floating-point tolerance. */
function isMultipleOf(input: number, requirement: number): boolean {
  if (requirement === 0) {
    return false;
  }
  const quotient = input / requirement;
  return (
    Math.abs(quotient - Math.round(quotient)) <=
    Number.EPSILON * Math.max(1, Math.abs(quotient)) * 10
  );
}

/** Create an action that requires a numeric multiple. */
export function multipleOf(
  requirement: number,
  message = `Expected a multiple of ${requirement}`,
): ValidationAction<number> {
  return validationAction(
    "multiple_of",
    `multiple of ${requirement}`,
    (input: number) => isMultipleOf(input, requirement),
    message,
    requirement,
  );
}

/** Create an action that requires a value greater than a threshold. */
export function gtValue<const TRequirement extends ValueInput>(
  requirement: TRequirement,
  message = `Expected a value greater than ${requirement}`,
): ValidationAction<ValueCategory<TRequirement>> {
  return validationAction(
    "gt_value",
    `value > ${requirement}`,
    (input: ValueCategory<TRequirement>) =>
      input.valueOf() > requirement.valueOf(),
    message,
    requirement,
  );
}

/** Create an action that requires a value less than a threshold. */
export function ltValue<const TRequirement extends ValueInput>(
  requirement: TRequirement,
  message = `Expected a value less than ${requirement}`,
): ValidationAction<ValueCategory<TRequirement>> {
  return validationAction(
    "lt_value",
    `value < ${requirement}`,
    (input: ValueCategory<TRequirement>) =>
      input.valueOf() < requirement.valueOf(),
    message,
    requirement,
  );
}

/** Create an action that requires one exact value. */
export function value(
  requirement: unknown,
  message = "Expected the required value",
): ValidationAction<unknown> {
  return validationAction(
    "value",
    String(requirement),
    (input: unknown) => Object.is(input, requirement),
    message,
    requirement,
  );
}

/** Create an action that requires one value from a fixed list. */
export function values(
  requirement: readonly unknown[],
  message = "Expected one allowed value",
): ValidationAction<unknown> {
  return validationAction(
    "values",
    "allowed value",
    (input: unknown) => requirement.some((value) => Object.is(value, input)),
    message,
    requirement,
  );
}

/** Create an action that rejects one exact value. */
export function notValue(
  requirement: unknown,
  message = "Expected a different value",
): ValidationAction<unknown> {
  return validationAction(
    "not_value",
    `not ${String(requirement)}`,
    (input: unknown) => !Object.is(input, requirement),
    message,
    requirement,
  );
}

/** Create an action that rejects every value from a fixed list. */
export function notValues(
  requirement: readonly unknown[],
  message = "Expected a value outside the rejected list",
): ValidationAction<unknown> {
  return validationAction(
    "not_values",
    "value outside rejected list",
    (input: unknown) => !requirement.some((value) => Object.is(value, input)),
    message,
    requirement,
  );
}

/** Create an identity action that adds a nominal brand to its output type. */
export function brand<TBrand extends PropertyKey>(): BrandAction<TBrand> {
  return {
    brand: true,
    kind: "transformation",
    "~run": (input) => input,
  };
}

/** Create an identity action that marks its output type readonly. */
export function readonly_(): ReadonlyAction {
  return {
    kind: "transformation",
    readonly: true,
    "~run": (input) => input,
  };
}

/** Create an action that converts a value to bigint. */
export function toBigint(): TransformationAction<unknown, bigint> {
  return {
    kind: "transformation",
    "~run": (input) => {
      try {
        return BigInt(input as string | number | bigint | boolean);
      } catch {
        return fail("to_bigint", "bigint-coercible value", input);
      }
    },
  };
}

/** Create an action that converts a value with JavaScript Boolean. */
export function toBoolean(): TransformationAction<unknown, boolean> {
  return transform((input: unknown) => Boolean(input));
}

/** Create an action that converts a value to a valid Date. */
export function toDate(): TransformationAction<unknown, Date> {
  return {
    kind: "transformation",
    "~run": (input) => {
      const output = new Date(input as string | number | Date);
      return Number.isNaN(output.getTime())
        ? fail("to_date", "date-coercible value", input)
        : output;
    },
  };
}

/** Create an action that converts a value to a non-NaN number. */
export function toNumber(): TransformationAction<unknown, number> {
  return {
    kind: "transformation",
    "~run": (input) => {
      const output = Number(input);
      return Number.isNaN(output)
        ? fail("to_number", "number-coercible value", input)
        : output;
    },
  };
}

/** Create an action that converts a value with JavaScript String. */
export function toString(): TransformationAction<unknown, string> {
  return transform((input: unknown) => String(input));
}

/** Create an action that parses JSON text. */
export function parseJson<TOutput = unknown>(): TransformationAction<
  string,
  TOutput
> {
  return {
    kind: "transformation",
    "~run": (input) => {
      try {
        return JSON.parse(input as string) as TOutput;
      } catch {
        return fail("parse_json", "JSON text", input);
      }
    },
  };
}

/** Create an action that serializes a JSON-compatible value. */
export function stringifyJson(): TransformationAction<unknown, string> {
  return {
    kind: "transformation",
    "~run": (input) => {
      try {
        const output = JSON.stringify(input);
        return output === undefined
          ? fail("stringify_json", "JSON-compatible value", input)
          : output;
      } catch {
        return fail("stringify_json", "JSON-compatible value", input);
      }
    },
  };
}

/** Create an action that parses explicit boolean text. */
export function parseBoolean(
  truthy: readonly string[] = ["true", "1", "yes", "on"],
  falsy: readonly string[] = ["false", "0", "no", "off"],
): TransformationAction<string, boolean> {
  return {
    kind: "transformation",
    "~run": (input) => {
      const normalized = (input as string).toLowerCase();
      if (truthy.includes(normalized)) {
        return true;
      }
      if (falsy.includes(normalized)) {
        return false;
      }
      return fail("parse_boolean", "boolean text", input);
    },
  };
}

/** Create an action that requires every array item to pass a predicate. */
export function everyItem<TItem>(
  requirement: (item: TItem, index: number) => boolean,
  message = "Expected every item to be valid",
): ValidationAction<readonly TItem[]> {
  return validationAction(
    "every_item",
    "all valid items",
    (input: readonly TItem[]) => input.every(requirement),
    message,
  );
}

/** Create an action that requires at least one matching array item. */
export function someItem<TItem>(
  requirement: (item: TItem, index: number) => boolean,
  message = "Expected a matching item",
): ValidationAction<readonly TItem[]> {
  return validationAction(
    "some_item",
    "matching item",
    (input: readonly TItem[]) => input.some(requirement),
    message,
  );
}

/** Create an action that filters array items into a new array. */
export function filterItems<TItem>(
  predicate: (item: TItem, index: number) => boolean,
): TransformationAction<readonly TItem[], TItem[]> {
  return transform((input: readonly TItem[]) => input.filter(predicate));
}

/** Create an action that finds the first matching array item. */
export function findItem<TItem>(
  predicate: (item: TItem, index: number) => boolean,
): TransformationAction<readonly TItem[], TItem | undefined> {
  return transform((input: readonly TItem[]) => input.find(predicate));
}

/** Create an action that maps array items into a new array. */
export function mapItems<TInput, TOutput>(
  operation: (item: TInput, index: number) => TOutput,
): TransformationAction<readonly TInput[], TOutput[]> {
  return transform((input: readonly TInput[]) => input.map(operation));
}

/** Create an action that reduces array items to one output. */
export function reduceItems<TItem, TOutput>(
  operation: (
    output: TOutput,
    item: TItem,
    index: number,
    items: readonly TItem[],
  ) => TOutput,
  initial: TOutput,
): TransformationAction<readonly TItem[], TOutput> {
  return transform((input: readonly TItem[]) =>
    input.reduce(operation, initial),
  );
}

/** Create an action that sorts a copied array. */
export function sortItems<TItem>(
  compare: (left: TItem, right: TItem) => number,
): TransformationAction<readonly TItem[], TItem[]> {
  return transform((input: readonly TItem[]) => [...input].sort(compare));
}

/** Create an action that requires a minimum value. */
export function minValue<const TRequirement extends ValueInput>(
  requirement: TRequirement,
  message = `Expected a value of at least ${requirement}`,
): ValidationAction<ValueCategory<TRequirement>> {
  return {
    actionType: "min_value",
    kind: "validation",
    requirement,
    "~run": (input) => {
      const value = input as ValueCategory<TRequirement>;
      if (value.valueOf() >= requirement.valueOf()) {
        return value;
      }
      return fail("min_value", `value >= ${requirement}`, input, message);
    },
  };
}

/** Create an action that requires a maximum value. */
export function maxValue<const TRequirement extends ValueInput>(
  requirement: TRequirement,
  message = `Expected a value of at most ${requirement}`,
): ValidationAction<ValueCategory<TRequirement>> {
  return {
    actionType: "max_value",
    kind: "validation",
    requirement,
    "~run": (input) => {
      const value = input as ValueCategory<TRequirement>;
      if (value.valueOf() <= requirement.valueOf()) {
        return value;
      }
      return fail("max_value", `value <= ${requirement}`, input, message);
    },
  };
}

/** Append validation or transformation actions to a schema. */
export function schema<
  const TSchema extends Schema<unknown, unknown>,
  const TActions extends SchemaActions,
>(
  schema: TSchema,
  ...actions: TActions &
    ValidSchemaActions<InferOutput<TSchema>, TActions> &
    ValidStreamingPlacement<TSchema, TActions>
): Schema<InferInput<TSchema>, SchemaOutput<InferOutput<TSchema>, TActions>> & {
  readonly actions: TActions;
  readonly wrapped: TSchema;
} {
  const streamingActions = actions.filter(
    (action) => action.actionType === "streaming",
  );
  if (streamingActions.length > 1) {
    throw new TypeError("A schema may contain only one streaming() checkpoint");
  }
  if (
    streamingActions.length === 1 &&
    schema.type !== "string" &&
    schema.type !== "object" &&
    schema.type !== "array"
  ) {
    throw new TypeError(
      "streaming() supports string, object, and array schemas",
    );
  }
  const schemaRun = schema["~run"];
  const actionRun = actions.length === 1 ? actions[0]?.["~run"] : undefined;
  const runActions = actionRun
    ? (input: unknown) =>
        actionRun(schemaRun(input)) as SchemaOutput<
          InferOutput<TSchema>,
          TActions
        >
    : (input: unknown) => {
        let output: unknown = schemaRun(input);
        const issues: Issue[] = [];
        for (const action of actions) {
          if (issues.length > 0 && action.kind === "transformation") {
            break;
          }
          try {
            output = action["~run"](output);
          } catch (error) {
            if (
              action.kind !== "validation" ||
              !(error instanceof ValidationError)
            ) {
              throw error;
            }
            issues.push(...error.issues);
          }
        }
        if (issues.length > 0) {
          throw new ValidationError(issues);
        }
        return output as SchemaOutput<InferOutput<TSchema>, TActions>;
      };
  const outputSchema = makeSchema<
    InferInput<TSchema>,
    SchemaOutput<InferOutput<TSchema>, TActions>
  >("schema", schema.expects, runActions) as Mutable<
    Schema<
      InferInput<TSchema>,
      SchemaOutput<InferOutput<TSchema>, TActions>
    > & {
      readonly actions: TActions;
      readonly wrapped: TSchema;
    }
  >;
  outputSchema.actions = actions;
  outputSchema.wrapped = schema;
  return outputSchema;
}

/** Append synchronous or asynchronous actions to a schema. */
export function schemaAsync<
  const TSchema extends GenericSchema<unknown, unknown>,
  const TActions extends AsyncSchemaActions,
>(
  schema: TSchema,
  ...actions: TActions &
    ValidAsyncSchemaActions<InferOutput<TSchema>, TActions> &
    ValidStreamingPlacement<TSchema, TActions>
): AsyncSchema<
  InferInput<TSchema>,
  AsyncSchemaOutput<InferOutput<TSchema>, TActions>
> & {
  readonly actions: TActions;
  readonly wrapped: TSchema;
} {
  const streamingActions = actions.filter(
    (candidate) =>
      "actionType" in candidate && candidate.actionType === "streaming",
  );
  if (streamingActions.length > 1) {
    throw new TypeError("A schema may contain only one streaming() checkpoint");
  }
  if (
    streamingActions.length === 1 &&
    (schema.async === true ||
      (schema.type !== "string" &&
        schema.type !== "object" &&
        schema.type !== "array"))
  ) {
    throw new TypeError(
      "streaming() supports string, object, and array schemas",
    );
  }
  const checkpoint = actions.findIndex(
    (candidate) =>
      "actionType" in candidate && candidate.actionType === "streaming",
  );
  if (
    checkpoint >= 0 &&
    actions
      .slice(0, checkpoint)
      .some((candidate) => "async" in candidate && candidate.async === true)
  ) {
    throw new TypeError(
      "Async actions cannot run before a streaming checkpoint",
    );
  }
  const withShape = (
    output: AsyncSchema<
      InferInput<TSchema>,
      AsyncSchemaOutput<InferOutput<TSchema>, TActions>
    >,
  ) => {
    const shaped = output as Mutable<
      typeof output & { readonly actions: TActions; readonly wrapped: TSchema }
    >;
    shaped.actions = actions;
    shaped.wrapped = schema;
    return shaped;
  };
  const action = actions.length === 1 ? actions[0] : undefined;
  if (
    schema.async === false &&
    action &&
    "async" in action &&
    action.async === true
  ) {
    const schemaRun = schema["~run"];
    const actionRun = action["~run"];
    if (
      schema === statelessSchemas[0] ||
      schema === statelessSchemas[1] ||
      schema === statelessSchemas[2]
    ) {
      return withShape(
        makeAsyncSchema("schema", schema.expects, (input) =>
          schema.type === typeof input && input === input
            ? (actionRun(input) as Promise<
                AsyncSchemaOutput<InferOutput<TSchema>, TActions>
              >)
            : Promise.resolve().then(
                () =>
                  schemaRun(input) as AsyncSchemaOutput<
                    InferOutput<TSchema>,
                    TActions
                  >,
              ),
        ),
      );
    }
    return withShape(
      makeAsyncSchema("schema", schema.expects, (input) => {
        try {
          return actionRun(schemaRun(input)) as Promise<
            AsyncSchemaOutput<InferOutput<TSchema>, TActions>
          >;
        } catch (error) {
          return Promise.reject(error);
        }
      }),
    );
  }
  return withShape(
    makeAsyncSchema("schema", schema.expects, async (input) => {
      let output: unknown =
        schema.async === true
          ? await schema["~run"](input)
          : schema["~run"](input);
      const issues: Issue[] = [];
      for (const action of actions) {
        if (issues.length > 0 && action.kind === "transformation") {
          break;
        }
        try {
          output =
            "async" in action && action.async === true
              ? await action["~run"](output)
              : action["~run"](output);
        } catch (error) {
          if (
            action.kind !== "validation" ||
            !(error instanceof ValidationError)
          ) {
            throw error;
          }
          issues.push(...error.issues);
        }
      }
      if (issues.length > 0) {
        throw new ValidationError(issues);
      }
      return output as AsyncSchemaOutput<InferOutput<TSchema>, TActions>;
    }),
  );
}

/** Create a schema that accepts undefined or a wrapped schema's output. */
export function optional<const TWrapped extends Schema<unknown, unknown>>(
  wrapped: TWrapped,
): OptionalSchema<TWrapped>;
/** Create an optional schema that replaces undefined with a default. */
export function optional<const TWrapped extends Schema<unknown, unknown>>(
  wrapped: TWrapped,
  default_: DefaultValue<InferOutput<TWrapped>>,
): OptionalDefaultSchema<TWrapped>;
export function optional<const TWrapped extends Schema<unknown, unknown>>(
  wrapped: TWrapped,
  default_?: DefaultValue<InferOutput<TWrapped>>,
): OptionalSchema<TWrapped> | OptionalDefaultSchema<TWrapped> {
  if (arguments.length > 1) {
    const defaultValue = default_ as DefaultValue<InferOutput<TWrapped>>;
    return schemaProperty(
      schemaProperty(
        schemaProperty(
          makeSchema<InferInput<TWrapped> | undefined, InferOutput<TWrapped>>(
            "optional",
            `${wrapped.expects} | undefined`,
            (input) =>
              input === undefined
                ? typeof defaultValue === "function"
                  ? (defaultValue as () => InferOutput<TWrapped>)()
                  : defaultValue
                : (wrapped["~run"](input) as InferOutput<TWrapped>),
          ),
          "~default",
          defaultValue,
        ),
        "~optional",
        true,
      ),
      "wrapped",
      wrapped,
    );
  }
  return schemaProperty(
    schemaProperty(
      makeSchema<
        InferInput<TWrapped> | undefined,
        InferOutput<TWrapped> | undefined
      >("optional", `${wrapped.expects} | undefined`, (input) =>
        input === undefined
          ? undefined
          : (wrapped["~run"](input) as InferOutput<TWrapped>),
      ),
      "~optional",
      true,
    ),
    "wrapped",
    wrapped,
  );
}

/** Create an async optional schema. */
export function optionalAsync<
  const TWrapped extends GenericSchema<unknown, unknown>,
>(wrapped: TWrapped): AsyncOptionalSchema<TWrapped>;
/** Create an async optional schema with a default output. */
export function optionalAsync<
  const TWrapped extends GenericSchema<unknown, unknown>,
>(
  wrapped: TWrapped,
  default_: DefaultValue<InferOutput<TWrapped>>,
): AsyncOptionalDefaultSchema<TWrapped>;
export function optionalAsync<
  const TWrapped extends GenericSchema<unknown, unknown>,
>(
  wrapped: TWrapped,
  default_?: DefaultValue<InferOutput<TWrapped>>,
): AsyncOptionalSchema<TWrapped> | AsyncOptionalDefaultSchema<TWrapped> {
  if (arguments.length > 1) {
    const defaultValue = default_ as DefaultValue<InferOutput<TWrapped>>;
    return schemaProperty(
      schemaProperty(
        schemaProperty(
          makeAsyncSchema<
            InferInput<TWrapped> | undefined,
            InferOutput<TWrapped>
          >("optional", `${wrapped.expects} | undefined`, async (input) =>
            input === undefined
              ? typeof defaultValue === "function"
                ? (defaultValue as () => InferOutput<TWrapped>)()
                : defaultValue
              : await wrapped["~run"](input),
          ),
          "~default",
          defaultValue,
        ),
        "~optional",
        true,
      ),
      "wrapped",
      wrapped,
    );
  }
  return schemaProperty(
    schemaProperty(
      makeAsyncSchema<
        InferInput<TWrapped> | undefined,
        InferOutput<TWrapped> | undefined
      >("optional", `${wrapped.expects} | undefined`, async (input) =>
        input === undefined ? undefined : await wrapped["~run"](input),
      ),
      "~optional",
      true,
    ),
    "wrapped",
    wrapped,
  );
}

/** Mark an object entry as optional while rejecting explicit undefined. */
export function exactOptional<const TWrapped extends Schema<unknown, unknown>>(
  wrapped: TWrapped,
): ExactOptionalSchema<TWrapped> {
  return schemaProperty(
    schemaProperty(
      schemaProperty(
        makeSchema<InferInput<TWrapped>, InferOutput<TWrapped>>(
          "exact_optional",
          wrapped.expects,
          wrapped["~run"],
        ),
        "~exactOptional",
        true,
      ),
      "~optional",
      true,
    ),
    "wrapped",
    wrapped,
  );
}

/** Mark an async object entry optional while rejecting explicit undefined. */
export function exactOptionalAsync<
  const TWrapped extends GenericSchema<unknown, unknown>,
>(wrapped: TWrapped): AsyncExactOptionalSchema<TWrapped> {
  return schemaProperty(
    schemaProperty(
      schemaProperty(
        makeAsyncSchema<InferInput<TWrapped>, InferOutput<TWrapped>>(
          "exact_optional",
          wrapped.expects,
          async (input) => await wrapped["~run"](input),
        ),
        "~exactOptional",
        true,
      ),
      "~optional",
      true,
    ),
    "wrapped",
    wrapped,
  );
}

/** Create a schema that accepts undefined or a wrapped schema's output. */
export function undefinedable<const TWrapped extends Schema<unknown, unknown>>(
  wrapped: TWrapped,
): Schema<
  InferInput<TWrapped> | undefined,
  InferOutput<TWrapped> | undefined
> & {
  readonly wrapped: TWrapped;
} {
  return schemaProperty(
    makeSchema<
      InferInput<TWrapped> | undefined,
      InferOutput<TWrapped> | undefined
    >("undefinedable", `${wrapped.expects} | undefined`, (input) =>
      input === undefined
        ? undefined
        : (wrapped["~run"](input) as InferOutput<TWrapped>),
    ),
    "wrapped",
    wrapped,
  );
}

/** Create an async undefinedable schema. */
export function undefinedableAsync<
  const TWrapped extends GenericSchema<unknown, unknown>,
>(
  wrapped: TWrapped,
): AsyncSchema<
  InferInput<TWrapped> | undefined,
  InferOutput<TWrapped> | undefined
> {
  return makeAsyncSchema(
    "undefinedable",
    `${wrapped.expects} | undefined`,
    async (input) =>
      input === undefined ? undefined : await wrapped["~run"](input),
  );
}

/** Create a schema that accepts null or a wrapped schema's output. */
export function nullable<const TWrapped extends Schema<unknown, unknown>>(
  wrapped: TWrapped,
): NullableSchema<TWrapped> {
  return schemaProperty(
    makeSchema<InferInput<TWrapped> | null, InferOutput<TWrapped> | null>(
      "nullable",
      `${wrapped.expects} | null`,
      (input) =>
        input === null
          ? null
          : (wrapped["~run"](input) as InferOutput<TWrapped>),
    ),
    "wrapped",
    wrapped,
  );
}

/** Create a schema that accepts null, undefined, or a wrapped output. */
export function nullish<const TWrapped extends Schema<unknown, unknown>>(
  wrapped: TWrapped,
): Schema<
  InferInput<TWrapped> | null | undefined,
  InferOutput<TWrapped> | null | undefined
> {
  return makeSchema(
    "nullish",
    `${wrapped.expects} | null | undefined`,
    (input) =>
      input == null ? input : (wrapped["~run"](input) as InferOutput<TWrapped>),
  );
}

/** Create an async schema that accepts null or a wrapped output. */
export function nullableAsync<
  const TWrapped extends GenericSchema<unknown, unknown>,
>(
  wrapped: TWrapped,
): AsyncSchema<InferInput<TWrapped> | null, InferOutput<TWrapped> | null> {
  return makeAsyncSchema(
    "nullable",
    `${wrapped.expects} | null`,
    async (input) => (input === null ? null : await wrapped["~run"](input)),
  );
}

/** Create an async schema that accepts null, undefined, or a wrapped output. */
export function nullishAsync<
  const TWrapped extends GenericSchema<unknown, unknown>,
>(
  wrapped: TWrapped,
): AsyncSchema<
  InferInput<TWrapped> | null | undefined,
  InferOutput<TWrapped> | null | undefined
> {
  return makeAsyncSchema(
    "nullish",
    `${wrapped.expects} | null | undefined`,
    async (input) => (input == null ? input : await wrapped["~run"](input)),
  );
}

/** Reject undefined after parsing a wrapped schema. */
export function nonOptional<const TWrapped extends Schema<unknown, unknown>>(
  wrapped: TWrapped,
): Schema<
  Exclude<InferInput<TWrapped>, undefined>,
  Exclude<InferOutput<TWrapped>, undefined>
> {
  return makeSchema("non_optional", wrapped.expects, (input) => {
    const output = wrapped["~run"](input);
    if (output !== undefined) {
      return output as Exclude<InferOutput<TWrapped>, undefined>;
    }
    return fail("non_optional", "defined value", input);
  });
}

/** Reject null after parsing a wrapped schema. */
export function nonNullable<const TWrapped extends Schema<unknown, unknown>>(
  wrapped: TWrapped,
): Schema<
  Exclude<InferInput<TWrapped>, null>,
  Exclude<InferOutput<TWrapped>, null>
> {
  return makeSchema("non_nullable", wrapped.expects, (input) => {
    const output = wrapped["~run"](input);
    if (output !== null) {
      return output as Exclude<InferOutput<TWrapped>, null>;
    }
    return fail("non_nullable", "non-null value", input);
  });
}

/** Reject null and undefined after parsing a wrapped schema. */
export function nonNullish<const TWrapped extends Schema<unknown, unknown>>(
  wrapped: TWrapped,
): Schema<
  NonNullable<InferInput<TWrapped>>,
  NonNullable<InferOutput<TWrapped>>
> {
  return makeSchema("non_nullish", wrapped.expects, (input) => {
    const output = wrapped["~run"](input);
    if (output != null) {
      return output as NonNullable<InferOutput<TWrapped>>;
    }
    return fail("non_nullish", "non-nullish value", input);
  });
}

/** Reject undefined after awaiting a wrapped schema. */
export function nonOptionalAsync<
  const TWrapped extends GenericSchema<unknown, unknown>,
>(
  wrapped: TWrapped,
): AsyncSchema<
  Exclude<InferInput<TWrapped>, undefined>,
  Exclude<InferOutput<TWrapped>, undefined>
> {
  return makeAsyncSchema("non_optional", wrapped.expects, async (input) => {
    const output = await wrapped["~run"](input);
    return output === undefined
      ? fail("non_optional", "defined value", input)
      : (output as Exclude<InferOutput<TWrapped>, undefined>);
  });
}

/** Reject null after awaiting a wrapped schema. */
export function nonNullableAsync<
  const TWrapped extends GenericSchema<unknown, unknown>,
>(
  wrapped: TWrapped,
): AsyncSchema<
  Exclude<InferInput<TWrapped>, null>,
  Exclude<InferOutput<TWrapped>, null>
> {
  return makeAsyncSchema("non_nullable", wrapped.expects, async (input) => {
    const output = await wrapped["~run"](input);
    return output === null
      ? fail("non_nullable", "non-null value", input)
      : (output as Exclude<InferOutput<TWrapped>, null>);
  });
}

/** Reject null and undefined after awaiting a wrapped schema. */
export function nonNullishAsync<
  const TWrapped extends GenericSchema<unknown, unknown>,
>(
  wrapped: TWrapped,
): AsyncSchema<
  NonNullable<InferInput<TWrapped>>,
  NonNullable<InferOutput<TWrapped>>
> {
  return makeAsyncSchema("non_nullish", wrapped.expects, async (input) => {
    const output = await wrapped["~run"](input);
    return output == null
      ? fail("non_nullish", "non-nullish value", input)
      : (output as NonNullable<InferOutput<TWrapped>>);
  });
}

/** Return a fallback output when a wrapped schema rejects input. */
export function fallback<const TSchema extends Schema<unknown, unknown>>(
  schema: TSchema,
  value:
    | InferOutput<TSchema>
    | ((error: ValidationError) => InferOutput<TSchema>),
): Schema<InferInput<TSchema>, InferOutput<TSchema>> & {
  readonly "~fallback":
    | InferOutput<TSchema>
    | ((error: ValidationError) => InferOutput<TSchema>);
  readonly wrapped: TSchema;
} {
  return schemaProperty(
    schemaProperty(
      makeSchema<InferInput<TSchema>, InferOutput<TSchema>>(
        "fallback",
        schema.expects,
        (input) => {
          try {
            return schema["~run"](input);
          } catch (error) {
            if (!(error instanceof ValidationError)) {
              throw error;
            }
            return typeof value === "function"
              ? (value as (error: ValidationError) => InferOutput<TSchema>)(
                  error,
                )
              : value;
          }
        },
      ),
      "~fallback",
      value,
    ),
    "wrapped",
    schema,
  );
}

/** Return an async fallback output when a wrapped schema rejects input. */
export function fallbackAsync<
  const TSchema extends GenericSchema<unknown, unknown>,
>(
  schema: TSchema,
  value:
    | InferOutput<TSchema>
    | ((
        error: ValidationError,
      ) => InferOutput<TSchema> | Promise<InferOutput<TSchema>>),
): AsyncSchema<InferInput<TSchema>, InferOutput<TSchema>> {
  return makeAsyncSchema("fallback", schema.expects, async (input) => {
    try {
      return await schema["~run"](input);
    } catch (error) {
      if (!(error instanceof ValidationError)) {
        throw error;
      }
      return typeof value === "function"
        ? await (
            value as (
              error: ValidationError,
            ) => InferOutput<TSchema> | Promise<InferOutput<TSchema>>
          )(error)
        : value;
    }
  });
}

/** Return a schema's optional default value, if present. */
export function getDefault(schema: GenericSchema<unknown, unknown>): unknown {
  if (!("~default" in schema)) {
    return undefined;
  }
  const value = schema["~default"];
  return typeof value === "function" ? (value as () => unknown)() : value;
}

/** Collect defaults from one object schema. */
export function getDefaults(
  schema: ObjectSchema<ObjectEntries> | AsyncObjectSchema<GenericObjectEntries>,
): Readonly<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(schema.entries)) {
    const value = getDefault(entry);
    if (value !== undefined) {
      output[key] = value;
    } else if ("entries" in entry) {
      const nested = getDefaults(
        entry as
          | ObjectSchema<ObjectEntries>
          | AsyncObjectSchema<GenericObjectEntries>,
      );
      if (Object.keys(nested).length > 0) {
        output[key] = nested;
      }
    }
  }
  return output;
}

/** Return a schema's fallback value, if present. */
export function getFallback(schema: Schema<unknown, unknown>): unknown {
  if (!("~fallback" in schema)) {
    return undefined;
  }
  const value = schema["~fallback"];
  return typeof value === "function"
    ? (value as (error: ValidationError) => unknown)(new ValidationError([]))
    : value;
}

/** Return the schema wrapped by a wrapper. */
export function unwrap<
  const TWrapped extends GenericSchema<unknown, unknown>,
>(schema: { readonly wrapped: TWrapped }): TWrapped {
  return schema.wrapped;
}

/** Replace validation messages raised inside one schema boundary. */
export function message<const TSchema extends Schema<unknown, unknown>>(
  schema: TSchema,
  value: string,
): Schema<InferInput<TSchema>, InferOutput<TSchema>> {
  return makeSchema("message", schema.expects, (input) => {
    try {
      return schema["~run"](input);
    } catch (error) {
      if (!(error instanceof ValidationError)) {
        throw error;
      }
      throw new ValidationError(
        error.issues.map((issue) => ({
          ...issue,
          message: value,
        })),
      );
    }
  });
}

/** Forward action issues to a nested path. */
export function forward<const TAction extends Action<unknown, unknown>>(
  action: TAction,
  path: readonly PropertyKey[],
): TAction {
  return {
    ...action,
    "~run": (input: unknown) => {
      try {
        return action["~run"](input);
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw error;
        }
        throw new ValidationError(
          error.issues.map((issue) => ({
            ...issue,
            path: [...path, ...issue.path],
          })),
        );
      }
    },
  } as TAction;
}

export type Metadata = Readonly<Record<string, unknown>>;

let metadataStore:
  | WeakMap<GenericSchema<unknown, unknown>, Metadata>
  | undefined;

/** Attach metadata to a schema and return the same schema. */
export function metadata<const TSchema extends GenericSchema<unknown, unknown>>(
  schema: TSchema,
  value: Metadata,
): TSchema {
  metadataStore ??= new WeakMap();
  metadataStore.set(schema, {
    ...metadataStore.get(schema),
    ...value,
  });
  return schema;
}

/** Read metadata attached to a schema. */
export function getMetadata(
  schema: GenericSchema<unknown, unknown>,
): Metadata | undefined {
  return metadataStore?.get(schema);
}

/** Attach a human-readable title to a schema. */
export function title<const TSchema extends Schema<unknown, unknown>>(
  schema: TSchema,
  value: string,
): TSchema {
  return metadata(schema, { title: value });
}

/** Read a schema's human-readable title. */
export function getTitle(
  schema: GenericSchema<unknown, unknown>,
): string | undefined {
  const value = getMetadata(schema)?.title;
  return typeof value === "string" ? value : undefined;
}

/** Attach a human-readable description to a schema. */
export function description<
  const TSchema extends GenericSchema<unknown, unknown>,
>(schema: TSchema, value: string): TSchema {
  return metadata(schema, { description: value });
}

/** Read a schema's human-readable description. */
export function getDescription(
  schema: GenericSchema<unknown, unknown>,
): string | undefined {
  const value = getMetadata(schema)?.description;
  return typeof value === "string" ? value : undefined;
}

/** Attach example values to a schema. */
export function examples<const TSchema extends GenericSchema<unknown, unknown>>(
  schema: TSchema,
  value: readonly InferOutput<TSchema>[],
): TSchema {
  return metadata(schema, { examples: value });
}

/** Read example values attached to a schema. */
export function getExamples(
  schema: GenericSchema<unknown, unknown>,
): readonly unknown[] | undefined {
  const value = getMetadata(schema)?.examples;
  return Array.isArray(value) ? value : undefined;
}

export class SchemaRegistry<TMetadata extends object> {
  private values = new WeakMap<object, TMetadata>();

  /** Add or replace metadata for a schema. */
  add(schema: GenericSchema<unknown, unknown>, value: TMetadata): this {
    this.values.set(schema, value);
    return this;
  }

  /** Read metadata for a schema. */
  get(schema: GenericSchema<unknown, unknown>): TMetadata | undefined {
    return this.values.get(schema);
  }

  /** Return whether the registry contains a schema. */
  has(schema: GenericSchema<unknown, unknown>): boolean {
    return this.values.has(schema);
  }

  /** Remove one schema from the registry. */
  remove(schema: GenericSchema<unknown, unknown>): boolean {
    return this.values.delete(schema);
  }

  /** Remove every schema from the registry. */
  clear(): void {
    this.values = new WeakMap();
  }
}

/** Create an isolated typed schema metadata registry. */
export function registry<
  TMetadata extends object = Metadata,
>(): SchemaRegistry<TMetadata> {
  return new SchemaRegistry<TMetadata>();
}

export type JsonSchema = boolean | Readonly<Record<string, unknown>>;

/** Return whether a schema exposes object entries. */
function hasEntries(
  schema: Schema<unknown, unknown>,
): schema is ObjectSchema<ObjectEntries> {
  return "entries" in schema;
}

/** Return whether a schema exposes one array item. */
function hasItem(
  schema: Schema<unknown, unknown>,
): schema is ArraySchema<Schema<unknown, unknown>> {
  return "item" in schema;
}

/** Return whether a schema exposes fixed tuple items. */
function hasItems(
  schema: Schema<unknown, unknown>,
): schema is TupleSchema<TupleItems> {
  return "items" in schema;
}

/** Return whether a schema exposes union options. */
function hasOptions(
  schema: Schema<unknown, unknown>,
): schema is UnionSchema<UnionOptions> {
  return "options" in schema;
}

/** Return whether a schema exposes one literal value. */
function hasLiteral(
  schema: Schema<unknown, unknown>,
): schema is LiteralSchema<Literal> {
  return "literal" in schema;
}

/** Return whether a schema exposes a fixed literal list. */
function hasLiterals(schema: Schema<unknown, unknown>): schema is Schema<
  unknown,
  unknown
> & {
  readonly literals: readonly Literal[];
} {
  return "literals" in schema;
}

/** Return whether a tuple schema exposes a rest schema. */
function hasRest(schema: Schema<unknown, unknown>): schema is Schema<
  unknown,
  unknown
> & {
  readonly items: TupleItems;
  readonly rest: Schema<unknown, unknown>;
} {
  return "items" in schema && "rest" in schema;
}

interface SchemaShape {
  readonly actions: SchemaActions;
  readonly wrapped: Schema<unknown, unknown>;
}

/** Return whether a schema exposes a source and actions. */
function hasSchemaActions(
  schema: Schema<unknown, unknown>,
): schema is Schema<unknown, unknown> & SchemaShape {
  return "actions" in schema && "wrapped" in schema;
}

interface RecordShape {
  readonly key: Schema<unknown, unknown>;
  readonly value: Schema<unknown, unknown>;
}

/** Return whether a schema exposes record key and value schemas. */
function hasRecord(
  schema: Schema<unknown, unknown>,
): schema is Schema<unknown, unknown> & RecordShape {
  return "key" in schema && "value" in schema;
}

interface JsonSchemaContext {
  readonly definitions: Record<string, JsonSchema>;
  readonly lazyNames: WeakMap<Schema<unknown, unknown>, string>;
  readonly target: "draft-07" | "draft-2020-12" | "openapi-3.0";
  nextName: number;
}

/** Return whether a schema exposes a lazily resolved schema. */
function hasLazySchema(
  schema: Schema<unknown, unknown>,
): schema is LazySchema<unknown, unknown, Schema<unknown, unknown>> {
  return "getSchema" in schema;
}

interface WrappedShape {
  readonly wrapped: Schema<unknown, unknown>;
}

/** Return whether a schema exposes one wrapped schema. */
function hasWrapped(
  schema: Schema<unknown, unknown>,
): schema is Schema<unknown, unknown> & WrappedShape {
  return "wrapped" in schema;
}

/** Convert one schema node without adding the root dialect marker. */
function convertJsonSchema(
  schema: Schema<unknown, unknown>,
  context: JsonSchemaContext,
): Record<string, unknown> {
  let output: Record<string, unknown>;
  if (hasLazySchema(schema)) {
    const priorName = context.lazyNames.get(schema);
    if (priorName) {
      return { $ref: `#/$defs/${priorName}` };
    }
    const name = `schema${context.nextName}`;
    context.nextName += 1;
    context.lazyNames.set(schema, name);
    context.definitions[name] = {};
    context.definitions[name] = convertJsonSchema(schema.getSchema(), context);
    output = { $ref: `#/$defs/${name}` };
  } else if (isOptional(schema)) {
    output = convertJsonSchema(schema.wrapped, context);
    if ("~default" in schema && typeof schema["~default"] !== "function") {
      output.default = schema["~default"];
    }
  } else if (
    hasWrapped(schema) &&
    (schema.type === "nullable" || schema.type === "nullish")
  ) {
    const wrapped = convertJsonSchema(schema.wrapped, context);
    output =
      context.target === "openapi-3.0"
        ? { ...wrapped, nullable: true }
        : { anyOf: [wrapped, { type: "null" }] };
  } else if (
    hasWrapped(schema) &&
    [
      "fallback",
      "message",
      "non_nullable",
      "non_nullish",
      "non_optional",
      "undefinedable",
    ].includes(schema.type)
  ) {
    output = convertJsonSchema(schema.wrapped, context);
  } else if (hasSchemaActions(schema)) {
    output = convertJsonSchema(schema.wrapped, context);
    for (const action of schema.actions) {
      switch (action.actionType) {
        case "gt_value":
          if (typeof action.requirement === "number") {
            output.exclusiveMinimum = action.requirement;
          }
          break;
        case "integer":
          output.type = "integer";
          break;
        case "lt_value":
          if (typeof action.requirement === "number") {
            output.exclusiveMaximum = action.requirement;
          }
          break;
        case "max_length":
          output.maxLength = action.requirement;
          break;
        case "max_value":
          if (typeof action.requirement === "number") {
            output.maximum = action.requirement;
          }
          break;
        case "min_length":
          output.minLength = action.requirement;
          break;
        case "min_value":
          if (typeof action.requirement === "number") {
            output.minimum = action.requirement;
          }
          break;
        case "multiple_of":
          output.multipleOf = action.requirement;
          break;
        case "regex":
          if ((action.requirement as RegExp).flags.length > 0) {
            throw new TypeError(
              "JSON Schema patterns cannot represent regular expression flags",
            );
          }
          output.pattern = (action.requirement as RegExp).source;
          break;
      }
    }
  } else if (hasLiteral(schema)) {
    output = { const: schema.literal };
  } else if (hasLiterals(schema)) {
    output = {
      anyOf: schema.literals.map((value) => ({ const: value })),
    };
  } else if (hasEntries(schema)) {
    const properties: Record<string, JsonSchema> = {};
    const requiredKeys: string[] = [];
    for (const [key, entry] of Object.entries(schema.entries)) {
      properties[key] = convertJsonSchema(entry, context);
      if (!isOptional(entry)) {
        requiredKeys.push(key);
      }
    }
    output = { properties, type: "object" };
    if (requiredKeys.length > 0) {
      output.required = requiredKeys;
    }
    if (schema.type === "strict_object") {
      output.additionalProperties = false;
    } else if (schema.type === "loose_object") {
      output.additionalProperties = true;
    }
  } else if (hasRecord(schema)) {
    output = {
      additionalProperties: convertJsonSchema(schema.value, context),
      type: "object",
    };
  } else if (hasItem(schema) && schema.type === "set") {
    output = {
      items: convertJsonSchema(schema.item, context),
      type: "array",
      uniqueItems: true,
    };
  } else if (hasItem(schema)) {
    output = {
      items: convertJsonSchema(schema.item, context),
      type: "array",
    };
  } else if (hasRest(schema)) {
    output = {
      items: convertJsonSchema(schema.rest, context),
      minItems: schema.items.length,
      prefixItems: schema.items.map((item) => convertJsonSchema(item, context)),
      type: "array",
    };
  } else if (hasItems(schema)) {
    output = {
      maxItems: schema.items.length,
      minItems: schema.items.length,
      prefixItems: schema.items.map((item) => convertJsonSchema(item, context)),
      type: "array",
    };
  } else if (hasOptions(schema)) {
    output = {
      [schema.type === "intersect" ? "allOf" : "anyOf"]: schema.options.map(
        (option) => convertJsonSchema(option, context),
      ),
    };
  } else {
    switch (schema.type) {
      case "bigint":
        output = { type: "integer" };
        break;
      case "boolean":
        output = { type: "boolean" };
        break;
      case "date":
        output = { format: "date-time", type: "string" };
        break;
      case "never":
      case "undefined":
        output = { not: {} };
        break;
      case "null":
        output = { type: "null" };
        break;
      case "number":
        output = { type: "number" };
        break;
      case "string":
        output = { type: "string" };
        break;
      case "unknown":
        output = {};
        break;
      default:
        throw new Error(
          `JSON Schema conversion does not support "${schema.type}" yet`,
        );
    }
  }
  return { ...output, ...getMetadata(schema) };
}

export interface JsonSchemaOptions {
  readonly target?: "draft-07" | "draft-2020-12" | "openapi-3.0";
}

/** Convert a supported schema tree to JSON Schema or OpenAPI Schema. */
export function toJSONSchema(
  schema: Schema<unknown, unknown>,
  options: JsonSchemaOptions = {},
): JsonSchema {
  const target = options.target ?? "draft-2020-12";
  const context: JsonSchemaContext = {
    definitions: {},
    lazyNames: new WeakMap(),
    target,
    nextName: 0,
  };
  const output: Record<string, unknown> = convertJsonSchema(schema, context);
  if (target === "draft-2020-12") {
    output.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (target === "draft-07") {
    output.$schema = "http://json-schema.org/draft-07/schema#";
  }
  if (Object.keys(context.definitions).length > 0) {
    output.$defs = context.definitions;
  }
  return output;
}

/** Return whether a JSON value is a schema object. */
function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Apply JSON Schema assertions that do not change the parsed output type. */
function applyJsonSchemaAssertions(
  schema: Schema<unknown, unknown>,
  source: Record<string, unknown>,
): Schema<unknown, unknown> {
  const pattern =
    typeof source.pattern === "string" ? new RegExp(source.pattern) : undefined;
  return makeSchema("json_schema", schema.expects, (input) => {
    const output = schema["~run"](input);
    if (typeof output === "string") {
      if (
        typeof source.minLength === "number" &&
        output.length < source.minLength
      ) {
        return fail("min_length", `length >= ${source.minLength}`, input);
      }
      if (
        typeof source.maxLength === "number" &&
        output.length > source.maxLength
      ) {
        return fail("max_length", `length <= ${source.maxLength}`, input);
      }
      if (pattern && !pattern.test(output)) {
        return fail("regex", String(pattern), input);
      }
      if (
        source.format === "email" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(output)
      ) {
        return fail("email", "email address", input);
      }
      if (
        source.format === "uri" &&
        !/^[a-z][a-z\d+.-]*:\/\/[^\s]+$/i.test(output)
      ) {
        return fail("url", "URL", input);
      }
    }
    if (typeof output === "number") {
      if (source.type === "integer" && !Number.isInteger(output)) {
        return fail("integer", "integer", input);
      }
      if (typeof source.minimum === "number" && output < source.minimum) {
        return fail("min_value", `value >= ${source.minimum}`, input);
      }
      if (typeof source.maximum === "number" && output > source.maximum) {
        return fail("max_value", `value <= ${source.maximum}`, input);
      }
      if (
        typeof source.exclusiveMinimum === "number" &&
        output <= source.exclusiveMinimum
      ) {
        return fail("min_value", `value > ${source.exclusiveMinimum}`, input);
      }
      if (
        typeof source.exclusiveMaximum === "number" &&
        output >= source.exclusiveMaximum
      ) {
        return fail("max_value", `value < ${source.exclusiveMaximum}`, input);
      }
      if (
        typeof source.multipleOf === "number" &&
        !isMultipleOf(output, source.multipleOf)
      ) {
        return fail("multiple_of", `multiple of ${source.multipleOf}`, input);
      }
    }
    if (Array.isArray(output)) {
      if (
        typeof source.minItems === "number" &&
        output.length < source.minItems
      ) {
        return fail("min_length", `length >= ${source.minItems}`, input);
      }
      if (
        typeof source.maxItems === "number" &&
        output.length > source.maxItems
      ) {
        return fail("max_length", `length <= ${source.maxItems}`, input);
      }
      if (
        source.uniqueItems === true &&
        new Set(output).size !== output.length
      ) {
        return fail("unique_items", "unique items", input);
      }
    }
    return output;
  });
}

interface JsonSchemaImportContext {
  readonly definitions: Readonly<Record<string, unknown>>;
  readonly references: Map<string, Schema<unknown, unknown>>;
}

/** Import one JSON Schema node. */
function importJsonSchema(
  source: JsonSchema,
  context: JsonSchemaImportContext,
): Schema<unknown, unknown> {
  if (source === true) {
    return unknown();
  }
  if (source === false) {
    return never();
  }
  if (typeof source.$ref === "string" && source.$ref.startsWith("#/$defs/")) {
    const name = source.$ref.slice("#/$defs/".length);
    const prior = context.references.get(name);
    if (prior) {
      return prior;
    }
    const recursive: Schema<unknown, unknown> = lazy(() => {
      const definition = context.definitions[name];
      if (
        definition !== true &&
        definition !== false &&
        !isJsonSchemaObject(definition)
      ) {
        throw new TypeError(`Missing JSON Schema definition "${name}"`);
      }
      return importJsonSchema(definition, context);
    });
    context.references.set(name, recursive);
    return recursive;
  }
  if ("const" in source) {
    return literal(source.const as Literal);
  }
  if (Array.isArray(source.enum)) {
    const values = source.enum as Literal[];
    if (values.length === 0) {
      return never();
    }
    if (values.length === 1) {
      return literal(values[0]);
    }
    return picklist(values as [Literal, ...Literal[]]);
  }
  if (Array.isArray(source.anyOf)) {
    const options = source.anyOf.map((option) =>
      importJsonSchema(option as JsonSchema, context),
    );
    if (options.length === 0) {
      return never();
    }
    if (options.length === 1) {
      return options[0] as Schema<unknown, unknown>;
    }
    return union(
      options as [Schema<unknown, unknown>, ...Schema<unknown, unknown>[]],
    );
  }
  if (Array.isArray(source.allOf)) {
    const options = source.allOf.map((option) =>
      importJsonSchema(option as JsonSchema, context),
    );
    if (options.length < 2) {
      return options[0] ?? unknown();
    }
    return intersect(
      options as [
        Schema<unknown, unknown>,
        Schema<unknown, unknown>,
        ...Schema<unknown, unknown>[],
      ],
    );
  }
  if (Array.isArray(source.type)) {
    const options = source.type.map((type) =>
      importJsonSchema({ ...source, type } as JsonSchema, context),
    );
    return options.length < 2
      ? (options[0] ?? unknown())
      : union(
          options as [Schema<unknown, unknown>, ...Schema<unknown, unknown>[]],
        );
  }

  let schema: Schema<unknown, unknown>;
  switch (source.type) {
    case "array": {
      if (Array.isArray(source.prefixItems)) {
        const items = source.prefixItems.map((item) =>
          importJsonSchema(item as JsonSchema, context),
        );
        schema = tuple(items);
      } else {
        schema = array(
          source.items === undefined
            ? unknown()
            : importJsonSchema(source.items as JsonSchema, context),
        );
      }
      break;
    }
    case "boolean":
      schema = boolean();
      break;
    case "integer":
    case "number":
      schema = number();
      break;
    case "null":
      schema = null_();
      break;
    case "object": {
      const properties = isJsonSchemaObject(source.properties)
        ? source.properties
        : {};
      const requiredKeys = new Set(
        Array.isArray(source.required)
          ? source.required.filter(
              (key): key is string => typeof key === "string",
            )
          : [],
      );
      const entries: Record<string, Schema<unknown, unknown>> = {};
      for (const [key, property] of Object.entries(properties)) {
        const entry = importJsonSchema(property as JsonSchema, context);
        entries[key] = requiredKeys.has(key) ? entry : optional(entry);
      }
      if (source.additionalProperties === false) {
        schema = strictObject(entries);
      } else if (isJsonSchemaObject(source.additionalProperties)) {
        schema = objectWithRest(
          entries,
          importJsonSchema(source.additionalProperties, context),
        );
      } else if (source.additionalProperties === true) {
        schema = looseObject(entries);
      } else {
        schema = object(entries);
      }
      break;
    }
    case "string":
      schema = string();
      break;
    default:
      schema =
        isJsonSchemaObject(source.not) && Object.keys(source.not).length === 0
          ? never()
          : unknown();
  }
  schema = applyJsonSchemaAssertions(schema, source);
  const schemaMetadata: Record<string, unknown> = {};
  for (const key of ["description", "examples", "title"] as const) {
    if (key in source) {
      schemaMetadata[key] = source[key];
    }
  }
  return Object.keys(schemaMetadata).length > 0
    ? metadata(schema, schemaMetadata)
    : schema;
}

/** Import a JSON Schema 2020-12 tree as a runtime schema. */
export function fromJSONSchema(source: JsonSchema): Schema<unknown, unknown> {
  const definitions =
    source !== false && source !== true && isJsonSchemaObject(source.$defs)
      ? source.$defs
      : {};
  return importJsonSchema(source, {
    definitions,
    references: new Map(),
  });
}

export interface ParseConfig {
  readonly abortEarly?: boolean;
}

/** Parse unknown input with a schema or throw a validation error. */
export function parse<TSchema extends Schema<unknown, unknown>>(
  schema: TSchema,
  input: unknown,
  config?: ParseConfig,
): InferOutput<TSchema> {
  if (config?.abortEarly) {
    const result = schema["~safe"](input);
    if (!result.success) {
      throw new ValidationError(result.issues.slice(0, 1));
    }
    return result.output;
  }
  return schema["~run"](input);
}

/** Parse unknown input without throwing for validation failures. */
export function safeParse<TSchema extends Schema<unknown, unknown>>(
  schema: TSchema,
  input: unknown,
  config?: ParseConfig,
): SafeParseResult<TSchema> {
  const result = schema["~safe"](input);
  return (
    !result.success && config?.abortEarly
      ? {
          issues: result.issues.slice(0, 1),
          output: undefined,
          success: false,
        }
      : result
  ) as SafeParseResult<TSchema>;
}

/** Parse unknown input with a sync or async schema. */
export function parseAsync<TSchema extends GenericSchema<unknown, unknown>>(
  schema: TSchema,
  input: unknown,
): Promise<InferOutput<TSchema>> {
  return schema.async
    ? (schema["~run"](input) as Promise<InferOutput<TSchema>>)
    : Promise.resolve().then(
        () => schema["~run"](input) as InferOutput<TSchema>,
      );
}

/** Parse unknown input asynchronously without throwing validation failures. */
export async function safeParseAsync<
  TSchema extends GenericSchema<unknown, unknown>,
>(schema: TSchema, input: unknown): Promise<SafeParseResult<TSchema>> {
  try {
    return {
      issues: undefined,
      output: await schema["~run"](input),
      success: true,
    };
  } catch (error) {
    if (!(error instanceof ValidationError)) {
      throw error;
    }
    return {
      issues: error.issues,
      output: undefined,
      success: false,
    };
  }
}

/** Create a reusable parser for one schema. */
export function parser<TSchema extends Schema<unknown, unknown>>(
  schema: TSchema,
): (input: unknown) => InferOutput<TSchema> {
  return schema["~run"];
}

/** Create a reusable safe parser for one schema. */
export function safeParser<TSchema extends Schema<unknown, unknown>>(
  schema: TSchema,
): (input: unknown) => SafeParseResult<TSchema> {
  return (input) => safeParse(schema, input);
}

/** Return whether unknown input satisfies a schema. */
export function is<TSchema extends Schema<unknown, unknown>>(
  schema: TSchema,
  input: unknown,
): input is InferInput<TSchema> {
  try {
    schema["~run"](input);
    return true;
  } catch (error) {
    if (error instanceof ValidationError) {
      return false;
    }
    throw error;
  }
}

/** Assert that unknown input satisfies a schema. */
export function assert<TSchema extends Schema<unknown, unknown>>(
  schema: TSchema,
  input: unknown,
): asserts input is InferInput<TSchema> {
  schema["~run"](input);
}

export interface FlattenedIssues {
  readonly nested: Readonly<Record<string, readonly string[]>>;
  readonly root: readonly string[];
}

/** Group validation messages by their dot-delimited issue path. */
export function flatten(error: ValidationError): FlattenedIssues {
  const nested: Record<string, string[]> = {};
  const root: string[] = [];
  for (const issue of error.issues) {
    if (issue.path.length === 0) {
      root.push(issue.message);
      continue;
    }
    const path = issue.path.map(String).join(".");
    (nested[path] ??= []).push(issue.message);
  }
  return { nested, root };
}

/** Format validation issues as one readable line per path. */
export function summarize(error: ValidationError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("\n");
}

export {
  createParserState,
  finalizeJsonParse,
  getResolvedValue,
  parseChunk,
  type JsonAstNode,
  type JsonResolvedValue,
  type JsonValue,
  type ParserError as StreamingError,
  type ParserLimits,
  type ParserOperation,
  type ParserState,
} from "./streaming/parser.js";

export {
  createResolutionCache,
  getStreamStatus,
  isStreamingSchema,
  resolveStreamingValue,
  validateFinalValue,
  type FinalValidationResult,
  type ResolutionCache,
  type StreamNodeStatus,
  type StreamPath,
  type StreamReadiness,
  type StreamingResolution,
  type StreamingResolutionError,
} from "./streaming/resolver.js";
