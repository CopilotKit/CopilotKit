import { chartDefinitions } from "./charts";
import { contentDefinitions } from "./content";
import { dataDefinitions } from "./data";
import { domainDefinitions } from "./domain";
import { feedbackDefinitions } from "./feedback";
import { inputDefinitions } from "./inputs";
import { layoutDefinitions } from "./layout";
import { mapDefinitions } from "./maps";

export const definitions = {
  ...layoutDefinitions,
  ...contentDefinitions,
  ...dataDefinitions,
  ...chartDefinitions,
  ...mapDefinitions,
  ...inputDefinitions,
  ...feedbackDefinitions,
  ...domainDefinitions,
};

export type Definitions = typeof definitions;
export type ComponentName = keyof Definitions;
