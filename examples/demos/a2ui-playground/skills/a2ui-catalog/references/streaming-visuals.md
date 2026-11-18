# Build-by-build streaming visuals

A2UI already delivers a surface operation by operation. Without visuals the user still sees a blank wait and then a "boom", and in Gen UI 2.0 a child that has not arrived renders nothing at all. These four pieces make the assembly visible, using only real numbers from the stream. Measured in the playground: dynamic surfaces show their first frame ~0.2 s after the composer's first token; fixed templates show their full skeleton the moment the router picks the tool (~1.2 to 1.5 s), seconds before the data lands.

## 1. A `Blueprint` stand-in component (templates/blueprint.tsx)

An internal component, registered in `createGenerativeUI` (templates/catalog.ts) but left out of the composer prompt (`HIDDEN` in templates/catalog-prompt.ts):

```ts
const blueprintSchema = z.object({
  of: z.string().optional(),
  h: z.number().optional(),
  state: z.string().optional(),
});
// renders: dashed outline, corner ticks, mono label "<of> <w>×<h>" measured with ResizeObserver,
// a slot height typical for the incoming type (Stat 104, LineChart 260, MapView 320, ...)
```

When the agent upserts the real component under the same id (`updateComponents` upserts by id, and a node may change its type), it replaces the frame. A CSS entrance on every node root (`opacity 0, blur(6px), translateY(3px)` to rest, 340 ms, `cubic-bezier(0.22, 1, 0.36, 1)`) makes it a crossfade. Honour `prefers-reduced-motion`. (The playground now draws labels and guides with a transitions.dev overlay and keeps its Blueprint a plain pulse; the template keeps the self-contained labelled frame.)

## 2. Dynamic mode: frames on id arrival

The component's id and type are its first keys, so they are readable long before the object closes. The incremental parser (templates/stream-parse.ts) exposes the open object's header:

```ts
private readHeader() {
  const head = this.text.slice(this.objStart, this.objStart + 400);
  const id = /"id"\s*:\s*"([^"]+)"/.exec(head)?.[1];
  const component = /"component"\s*:\s*"([^"]+)"/.exec(head)?.[1];
  if (id && component) this.open = { id, component, start: this.objStart };
}
```

The composer then upserts: a Blueprint for the open component on every new header, and with each finished (repaired) component a labelled pending Blueprint for every child id it references whose object has not started:

```ts
surface.upsert({
  id: open.id,
  component: "Blueprint",
  of: open.component,
  state: "streaming",
});
const pending = childRefs(done)
  .filter((id) => !sent.has(id))
  .map((id) => ({
    id,
    component: "Blueprint",
    of: `#${id}`,
    state: "pending",
  }));
surface.upsert(done, ...pending);
```

The layout appears as frames top-down, then fills.

## 3. Fixed mode: the template skeleton at tool pick

The tree of a fixed template is a constant, known the instant the router's `show_*` tool call starts (before its arguments finish streaming). Create the surface right then, under the surface id the data will use, with containers real and every leaf as a Blueprint:

```ts
const LAYOUT = new Set(["Column", "Row", "Grid", "Card", "Section", "List"]);
export function blueprintOf(components) {
  return components.map((c) =>
    LAYOUT.has(c.component)
      ? c
      : { id: c.id, component: "Blueprint", of: c.component },
  );
}
// on TOOL_CALL_START of a show_* tool:
new SurfaceStream(q, `${tree.template}-${toolCallId.slice(-6)}`).create(
  blueprintOf(tree.components),
);
```

When the data lands, the agent appends `updateDataModel` and then the real components to the same surface, so the frames are replaced by data-bound components. If the tool fails, upsert `root` as an `Alert` explaining why; never leave orphaned frames.

## 4. Measured rects and the build log

Gen UI 2.0 does not hand a component its id. catalog.ts wraps each of your components so the DOM carries its type without changing layout:

```ts
createElement(
  "div",
  { className: "a2-node", "data-a2-type": name },
  createElement(Render, { props }),
); // .a2-node { display: contents }
```

The engine renders depth-first from `root`, children in order, so the k-th `.a2-node` of a type is the k-th component of that type in a depth-first walk of the latest operations (templates/node-rects.ts: `nodeElements(host, ops)`; a `{ componentId, path }` template counts once per list item). Standard components draw no wrapper and get no rect. `display: contents` keeps layouts intact, but parent selectors like `[&>*]:flex-1` must also target `[&>.a2-node>*]`. Measure `node.firstElementChild.getBoundingClientRect()` relative to the surface host every ~160 ms while building and once when done. A build log built from real data:

- PARTS done/total from the latest operations (Blueprint = frame, anything else = ok)
- per part: id, type, x,y, w×h (measured), state `[......]` pending, `[###...]` streaming (characters of the open object so far), `[  ok  ]`
- TOK/S and tokens from the composer stream (a throttled progress event), elapsed from the run start
- a wireframe map: every part's measured rect drawn on a dotted canvas, scaled to fit, labelled with type and size

Keep the frames and labels subtle where surfaces are read (chat bubbles); put the full log in an inspector, and let it collapse once the build is done.

## Pitfalls

- First-frame vs first-content: count a surface as painted only when it has a non-Blueprint leaf, and report the frame time separately.
- A Blueprint label inside a very short slot (Text ~20 px) needs a min-height (28 px).
- Do not send `createSurface` again for a surface that exists; the client rejects it. Append to its activity message.
- Record frames (time + operations) per run if you want a replay: a recorded run replayed at its recorded pace through `StaticSurface` is an honest demo.

## Three-phase build (round 6)

The playground presents every surface in three phases, driven only by real operation arrival times:

1. Skeleton: each component id that has arrived is a dotted frame with corner handles and a `Name w×h` label.
2. Pass: a scan line moves down at a fixed speed (`--scan-speed`, 900 px/s); a frame locks (solid outline, `[ ok ]`) when the line reaches its top.
3. Fill: leaves replace their frames in the order their props really arrived, after their frame locked and at least `--frame-dwell` (120 ms) after the previous fill. Text streams word by word, numbers pop in, chart marks grow, map pins drop.

Code: `src/lib/build-timeline.ts` (pure, testable `present(snaps, T, topOf)`), `src/components/app/use-ui-generation.ts` (the transitions.dev overlay over a streaming surface, vendored in `src/vendor/transitions`), `src/styles/motion.css` (all recipes; transitions.dev recipes credited in its header).
