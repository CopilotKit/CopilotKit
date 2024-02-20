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
  attributes?: Parameter[]; // Optional for defining nested object structures
};

export type Parameter = BaseParameter | StringParameter | ObjectParameter;

type MappedParameterTypes<T extends Parameter[]> = {
  // Check if enum is defined
  [P in T[number] as P["name"]]: P extends { enum: Array<infer E> }
    ? // Ensure the inferred type E is string to match enum usage
      E extends string
      ? // Check if the parameter is marked as not required
        P["required"] extends false
        ? // Make the type union with undefined
          E | undefined
        : // Use the inferred  type directly
          E
      : // If E is not string, this case should never happen
        never
    : // Handle object types with attributes
    P extends { type: "object" | "object[]"; attributes: infer Attributes }
    ? Attributes extends Parameter[]
      ? // Recursively process nested attributes
        MappedParameterTypes<Attributes>
      : never
    : // For types without enum and not object with attributes
    // Check if the parameter is marked as not required
    P["required"] extends false
    ? // Make the type union with undefined
      TypeMap[P["type"] extends keyof TypeMap ? P["type"] : "string"] | undefined
    : // Directly use TypeMap for type resolution
      TypeMap[P["type"] extends keyof TypeMap ? P["type"] : "string"];
};

export type Action<T extends Parameter[] | [] = []> = {
  name: string;
  description?: string;
  parameters?: T;
  handler: T extends [] ? () => void : (args: MappedParameterTypes<T>) => any | Promise<any>;
};
