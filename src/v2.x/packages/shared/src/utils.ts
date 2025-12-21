import { v4 as uuidv4 } from "uuid";
import * as PartialJSON from "partial-json";

export function randomUUID() {
  return uuidv4();
}

export function partialJSONParse(json: string) {
  try {
    return PartialJSON.parse(json);
  } catch (error) {
    return {};
  }
}
