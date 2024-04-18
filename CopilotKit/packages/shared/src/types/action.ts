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

type AbstractParameter = {
  name: string;
  type?: keyof TypeMap;
  description?: string;
  required?: boolean;
};

interface StringParameter extends AbstractParameter {
  type: "string";
  enum?: string[];
}

interface ObjectParameter extends AbstractParameter {
  type: "object";
  attributes?: Parameter[];
}

interface ObjectArrayParameter extends AbstractParameter {
  type: "object[]";
  attributes?: Parameter[];
}

type SpecialParameters = StringParameter | ObjectParameter | ObjectArrayParameter;
interface BaseParameter extends AbstractParameter {
  type?: Exclude<AbstractParameter["type"], SpecialParameters["type"]>;
}

export type Parameter = BaseParameter | SpecialParameters;

type OptionalParameterType<P extends AbstractParameter> = P["required"] extends false
  ? undefined
  : never;

type StringParameterType<P> = P extends StringParameter
  ? P extends { enum?: Array<infer E> }
    ? E
    : string
  : never;

type ObjectParameterType<P> = P extends ObjectParameter
  ? P extends { attributes?: infer Attributes extends Parameter[] }
    ? MappedParameterTypes<Attributes>
    : object
  : never;

type ObjectArrayParameterType<P> = P extends ObjectArrayParameter
  ? P extends { attributes?: infer Attributes extends Parameter[] }
    ? MappedParameterTypes<Attributes>[]
    : any[]
  : never;

type MappedTypeOrString<T> = T extends keyof TypeMap ? TypeMap[T] : string;
type BaseParameterType<P extends AbstractParameter> = P extends { type: infer T }
  ? T extends BaseParameter["type"]
    ? MappedTypeOrString<T>
    : never
  : string;

export type MappedParameterTypes<T extends Parameter[] | [] = []> = T extends []
  ? Record<string, any>
  : {
      [P in T[number] as P["name"]]:
        | OptionalParameterType<P>
        | StringParameterType<P>
        | ObjectParameterType<P>
        | ObjectArrayParameterType<P>
        | BaseParameterType<P>;
    };

export type Action<T extends Parameter[] | [] = []> = {
  name: string;
  description?: string;
  parameters?: T;
  handler: T extends []
    ? () => any | Promise<any>
    : (args: MappedParameterTypes<T>) => any | Promise<any>;
};

// This is the original "ceiling is being raised" version of MappedParameterTypes.
//
// ceiling is being raised. cursor's copilot helped us write "superhuman code"
// for a critical feature. We can read this code, but VERY few engineers out
// there could write it from scratch.
// Took lots of convincing too. "come on, this must be possible, try harder".
// and obviously- done in parts.
//
// - https://twitter.com/ataiiam/status/1765089261374914957
//   (Mar 5, 2024)
//
// export type MappedParameterTypes<T extends Parameter[]> = {
//   // Check if the parameter has an 'enum' defined
//   [P in T[number] as P["name"]]: P extends { enum: Array<infer E> }
//     ? E extends string // Ensure the enum values are strings
//       ? P["required"] extends false // Check if the parameter is optional
//         ? E | undefined // If so, include 'undefined' in the type
//         : E // Otherwise, use the enum type directly
//       : never // This case should not occur since 'enum' implies string values
//     : // Handle parameters defined as 'object' with specified attributes
//     P extends { type: "object"; attributes: infer Attributes }
//     ? Attributes extends Parameter[]
//       ? MappedParameterTypes<Attributes> // Recursively map the attributes of the object
//       : never // If 'attributes' is not an array of Parameters, this is invalid
//     : // Handle parameters defined as 'object[]' without specified attributes
//     P extends { type: "object[]"; attributes?: never }
//     ? any[] // Default to 'any[]' for arrays of objects without specific attributes
//     : // Handle parameters defined as 'object[]' with specified attributes
//     P extends { type: "object[]"; attributes: infer Attributes }
//     ? Attributes extends Parameter[]
//       ? MappedParameterTypes<Attributes>[] // Recursively map each object in the array
//       : any[] // Default to 'any[]' if attributes are not properly defined
//     : // Handle all other parameter types
//     P["required"] extends false
//     ? // Include 'undefined' for optional parameters
//       TypeMap[P["type"] extends keyof TypeMap ? P["type"] : "string"] | undefined
//     : // Use the direct mapping from 'TypeMap' for the parameter's type
//       TypeMap[P["type"] extends keyof TypeMap ? P["type"] : "string"];
// };
