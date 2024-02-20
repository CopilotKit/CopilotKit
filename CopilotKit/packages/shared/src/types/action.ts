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

type Action<T extends Parameter[]> = {
  parameters: [...T];
  handler: (args: MappedParameterTypes<T>) => void;
};

// TODO add const back (prettier chokes on it)
export function useCopilotAction</* const */ T extends Parameter[]>(action: Action<T>): void {}

// Usage Example:
useCopilotAction({
  parameters: [
    { name: "arg1", type: "string", enum: ["option1", "option2", "option3"], required: false },
    { name: "arg2", type: "number" },
    {
      name: "arg3",
      type: "object",
      attributes: [
        { name: "nestedArg1", type: "boolean" },
        { name: "xyz", required: false },
      ] as const,
    },
    { name: "arg4", type: "number[]" },
  ] as const,
  handler: ({ arg1, arg2, arg3, arg4 }) => {
    const x = arg3.nestedArg1;
    const z = arg3.xyz;
    console.log(arg1, arg2, arg3);
  },
});

// https://community.openai.com/t/function-call-complex-arrays-as-parameters/295648/3
