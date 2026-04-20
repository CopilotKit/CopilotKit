export type FormField =
  | {
      kind: "string";
      name: string;
      label: string;
      enum?: string[];
      required: boolean;
      description?: string;
    }
  | {
      kind: "number";
      name: string;
      label: string;
      required: boolean;
      description?: string;
    }
  | {
      kind: "boolean";
      name: string;
      label: string;
      required: boolean;
      description?: string;
    }
  | {
      kind: "array";
      name: string;
      label: string;
      items: FormField;
      required: boolean;
      description?: string;
    }
  | {
      kind: "object";
      name: string;
      label: string;
      fields: FormField[];
      required: boolean;
      description?: string;
    }
  | {
      kind: "raw-json";
      name: string;
      label: string;
      hint: string;
      required: boolean;
      description?: string;
    };

export interface FormSchema {
  fields: FormField[];
}
