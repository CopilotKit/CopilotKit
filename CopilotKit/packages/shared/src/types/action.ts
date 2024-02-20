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

type MappedParameterTypes<T extends Parameter[]> = {
  // Check if the parameter has an 'enum' defined
  [P in T[number] as P["name"]]: P extends { enum: Array<infer E> }
    ? E extends string // Ensure the enum values are strings
      ? P["required"] extends false // Check if the parameter is optional
        ? E | undefined // If so, include 'undefined' in the type
        : E // Otherwise, use the enum type directly
      : never // This case should not occur since 'enum' implies string values
    : // Handle parameters defined as 'object' with specified attributes
    P extends { type: "object"; attributes: infer Attributes }
    ? Attributes extends Parameter[]
      ? MappedParameterTypes<Attributes> // Recursively map the attributes of the object
      : never // If 'attributes' is not an array of Parameters, this is invalid
    : // Handle parameters defined as 'object[]' without specified attributes
    P extends { type: "object[]"; attributes?: never }
    ? any[] // Default to 'any[]' for arrays of objects without specific attributes
    : // Handle parameters defined as 'object[]' with specified attributes
    P extends { type: "object[]"; attributes: infer Attributes }
    ? Attributes extends Parameter[]
      ? MappedParameterTypes<Attributes>[] // Recursively map each object in the array
      : any[] // Default to 'any[]' if attributes are not properly defined
    : // Handle all other parameter types
    P["required"] extends false
    ? // Include 'undefined' for optional parameters
      TypeMap[P["type"] extends keyof TypeMap ? P["type"] : "string"] | undefined
    : // Use the direct mapping from 'TypeMap' for the parameter's type
      TypeMap[P["type"] extends keyof TypeMap ? P["type"] : "string"];
};

export type Action<T extends Parameter[] | [] = []> = {
  name: string;
  description?: string;
  parameters?: T;
  handler: T extends [] ? () => void : (args: MappedParameterTypes<T>) => any | Promise<any>;
};
