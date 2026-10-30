import type { ComponentName } from "../definitions";

export type SampleComponent = { id: string; component: string } & Record<string, unknown>;

/**
 * A catalog preview: a tiny A2UI surface whose root ("root") is the component
 * being documented. Containers include their child components too.
 * `data` seeds the data model (used for bound input values).
 */
export type Sample = { components: SampleComponent[]; data?: Record<string, unknown>; wide?: boolean };

export type SampleMap<K extends ComponentName> = { [P in K]: Sample };
