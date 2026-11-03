import { filterCatalog } from "./my-catalog";
import { OpenGenerativeUIContentSchema } from "./schemas";

export const kept = filterCatalog<string>(["a"], () => true);
export const parsed = OpenGenerativeUIContentSchema.parse({});
