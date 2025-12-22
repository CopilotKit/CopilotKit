import { StandardSchemaWithJSON } from "../types";

export function isStandardSchemaWithJSON(obj: object): obj is StandardSchemaWithJSON {
  return !!(
    obj &&
    "~standard" in obj &&
    typeof obj["~standard"] === "object" &&
    obj["~standard"] &&
    "jsonSchema" in obj["~standard"] &&
    typeof obj["~standard"]["jsonSchema"] === "object" &&
    obj["~standard"]["jsonSchema"] !== null &&
    "input" in obj["~standard"]["jsonSchema"] &&
    typeof obj["~standard"]["jsonSchema"].input === "function" &&
    "validate" in obj["~standard"] &&
    typeof obj["~standard"]["validate"] === "function"
  );
}
