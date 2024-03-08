type TypeMap = {
  string: string;
  number: number;
  boolean: boolean;
  object: object;
  "string[]": string[];
  "number[]": number[];
  "boolean[]": boolean[];
  "object[]": object[];
};

export type BaseParameter = {
  name: string;
  type?: Exclude<keyof TypeMap, "string" | "object" | "object[]">; // Exclude object types for BaseParameter
  description?: string;
  required?: boolean;
};

export type StringParameter = {
  name: string;
  type: "string";
  description?: string;
  required?: boolean;
  enum?: string[];
};

export type ObjectParameter = {
  name: string;
  type: "object" | "object[]";
  description?: string;
  required?: boolean;
  attributes?: Parameter[];
};

export type Parameter = BaseParameter | StringParameter | ObjectParameter;

type EnumParameterType<E, Required> = E extends string
  ? Required extends false
    ? E | undefined
    : E
  : never;

type ObjectTypeParameter<Attributes> = Attributes extends Parameter[]
  ? MappedParameterTypes<Attributes>
  : never;

type ObjectArrayTypeParameter<Attributes> = Attributes extends Parameter[]
  ? MappedParameterTypes<Attributes>[]
  : any[];

type OtherParameterType<Type, Required> = Required extends false
  ? TypeMap[Type extends keyof TypeMap ? Type : "string"] | undefined
  : TypeMap[Type extends keyof TypeMap ? Type : "string"];

// prettier-ignore
export type MappedParameterTypes<T extends Parameter[]> = {
    [P in T[number] as P["name"]]: P extends { enum: Array<infer E> } ? EnumParameterType<E, P["required"]>
    : P extends { type: "object"; attributes: infer Attributes } ? ObjectTypeParameter<Attributes>
    : P extends { type: "object[]"; attributes?: never } ? any[]
    : P extends { type: "object[]"; attributes: infer Attributes } ? ObjectArrayTypeParameter<Attributes>
    : OtherParameterType<P["type"], P["required"]>;
};

export type Action<T extends Parameter[] | [] = []> = {
  name: string;
  description?: string;
  parameters?: T;
  handler: T extends []
    ? () => any | Promise<any>
    : (args: MappedParameterTypes<T>) => any | Promise<any>;
};
