export type DisplayValue =
  | string
  | number
  | boolean
  | null
  | DisplayValue[]
  | { [key: string]: DisplayValue };

export type SerializeDisplayValueOptions = Readonly<{
  pretty?: boolean;
}>;
