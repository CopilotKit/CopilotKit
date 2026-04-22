import type { FormField } from "./schema/types";
import { StringField } from "./fields/StringField";
import { NumberField } from "./fields/NumberField";
import { BooleanField } from "./fields/BooleanField";
import { ArrayField } from "./fields/ArrayField";
import { ObjectField } from "./fields/ObjectField";
import { RawJsonField } from "./fields/RawJsonField";

export function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.kind) {
    case "string":
      return (
        <StringField
          field={field}
          value={value as string | undefined}
          onChange={onChange as (v: string) => void}
        />
      );
    case "number":
      return (
        <NumberField
          field={field}
          value={value as number | undefined}
          onChange={onChange as (v: number | undefined) => void}
        />
      );
    case "boolean":
      return (
        <BooleanField
          field={field}
          value={value as boolean | undefined}
          onChange={onChange as (v: boolean) => void}
        />
      );
    case "array":
      return (
        <ArrayField
          field={field}
          value={value as unknown[] | undefined}
          onChange={onChange as (v: unknown[]) => void}
        />
      );
    case "object":
      return (
        <ObjectField
          field={field}
          value={value as Record<string, unknown> | undefined}
          onChange={onChange as (v: Record<string, unknown>) => void}
        />
      );
    case "raw-json":
      return <RawJsonField field={field} value={value} onChange={onChange} />;
  }
}
