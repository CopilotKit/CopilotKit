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

type Parameter = {
  name: string;
  type?: keyof TypeMap;
  description?: string;
  required?: boolean;
  enum?: string[];
};

type MappedParameterTypes<T extends Parameter[]> = {
  [P in T[number] as P["name"]]: P["enum"] extends Array<infer E>
    ? E extends string
      ? P["required"] extends false
        ? E | undefined
        : E
      : never
    : P["required"] extends false
    ? TypeMap[P["type"] extends keyof TypeMap ? P["type"] : "string"] | undefined
    : TypeMap[P["type"] extends keyof TypeMap ? P["type"] : "string"];
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
    { name: "arg3", type: "boolean" },
    { name: "arg4", type: "number[]" },
  ] as const,
  handler: ({ arg1, arg2, arg3, arg4 }) => {
    console.log(arg1, arg2, arg3); // arg1 is now typed as "option1" | "option2" | undefined
  },
});

// TODO support array
// https://community.openai.com/t/function-call-complex-arrays-as-parameters/295648/3

// TODO remove enum when using "array" type
