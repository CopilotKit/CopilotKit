export type Component = { id: string; component: string } & Record<
  string,
  unknown
>;

/** A pre-authored surface: a fixed component tree plus the data it binds to. */
export type FixedSurface = {
  /** Stable template id, also used as the surface id prefix. */
  template: string;
  title: string;
  components: Component[];
  data: Record<string, unknown>;
  /** Where the data came from, shown in the surface footer. */
  source: string;
};
