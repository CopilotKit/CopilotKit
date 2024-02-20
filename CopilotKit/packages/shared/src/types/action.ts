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

type BaseParameter = {
  name: string;
  type?: Exclude<keyof TypeMap, "string" | "object" | "object[]">; // Exclude object types for BaseParameter
  description?: string;
  required?: boolean;
};

type StringParameter = {
  name: string;
  type: "string";
  description?: string;
  required?: boolean;
  enum?: string[];
};

type ObjectParameter = {
  name: string;
  type: "object" | "object[]";
  description?: string;
  required?: boolean;
  attributes?: Parameter[]; // Optional for defining nested object structures
};

type Parameter = BaseParameter | StringParameter | ObjectParameter;

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

type Action<T extends Parameter[] | [] = []> = {
  name: string;
  description?: string;
  parameters?: T;
  handler: T extends [] ? () => void : (args: MappedParameterTypes<T>) => void;
};

// Prettier chokes on the `const` in the function signature
// as a workaround, comment out the const keyword when working with this code and
// uncomment when done

// prettier-ignore
export function useCopilotAction<const T extends Parameter[] | [] = []>(action: Action<T>): void {
  // Function implementation...
}

// https://community.openai.com/t/function-call-complex-arrays-as-parameters/295648/3
