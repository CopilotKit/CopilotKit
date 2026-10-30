import type { ReactNode } from "react";
import type { z } from "zod";
import type { Definitions } from "../definitions";

type Out<K extends keyof Definitions> = z.output<Definitions[K]["props"]>;

/** A writable `value` prop gets a setter that writes the bound data-model path. */
type ValueSetter<T> = "value" extends keyof T ? { setValue?: (value: NonNullable<T["value" & keyof T]>) => void } : unknown;

/**
 * What a renderer gets: the props after the Gen UI 2.0 engine resolved every
 * `{ "@path" }` binding and `{ "@call" }` function, child references as
 * rendered nodes, `setValue` for writable inputs, and `action` for the
 * component's `onAction` event (when the model bound one).
 */
export type Props<K extends keyof Definitions> = Out<K> & ValueSetter<Out<K>> & { action?: () => void };

export type RendererProps<K extends keyof Definitions> = { props: Props<K> };

export type Renderer<K extends keyof Definitions> = (p: RendererProps<K>) => ReactNode;
export type RendererMap<Keys extends keyof Definitions> = { [K in Keys]: Renderer<K> };
