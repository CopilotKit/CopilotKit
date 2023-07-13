export interface AnnotatedFunctionArgument {
  name: string;
  type: string;
  description: string;
  allowedValues?: any[];
  required: boolean;
}

export interface AnnotatedFunction<Inputs extends any[]> {
  name: string;
  description: string;
  argumentAnnotations: AnnotatedFunctionArgument[];
  implementation: (...args: Inputs) => Promise<void>;
}
