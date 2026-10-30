# Fixed-schema surfaces

The component tree is a constant. The agent's tool only supplies data. Nothing writes UI at runtime, so a fixed surface paints as soon as its data lands.

## Anatomy

```ts
const p = (path: string) => ({ "@path": path });

export const WEATHER = [
  { id: "root", component: "Column", gap: 2, children: ["card", "rain", "source"] },
  { id: "card", component: "WeatherCard", location: p("/location"), temp: p("/now/temp"),
    condition: p("/now/condition"), icon: p("/now/icon"), hourly: p("/hourly"), daily: p("/daily") },
  { id: "rain", component: "BarChart", title: "Chance of rain", format: "percent", data: p("/rain") },
  { id: "source", component: "Caption", text: p("/source") },
];

export function weatherSurface(w: Weather) {
  return {
    template: "weather",
    components: WEATHER,
    data: {
      location: `${w.place.name}, ${w.place.country}`,
      now: { temp: w.current.temp, condition: w.current.condition, icon: w.current.icon },
      rain: w.hourly.map((h) => ({ x: h.label, y: h.precip })),
      source: "Live from Open-Meteo",
      /* ... */
    },
  };
}
```

`Column` and `Caption` are standard components (numeric `gap`); `WeatherCard` and `BarChart` are the app's own.

## The agent writes the surface

```ts
// TOOL_CALL_START of show_weather: the tree is known, paint it now (containers real, leaves as Blueprint frames)
new SurfaceStream(q, `weather-${callId.slice(-6)}`).create(blueprintOf(WEATHER));

// the data landed: data first, then the components (upsert by id replaces each frame), then done
const stream = new SurfaceStream(q, surfaceId);
stream.data(surface.data);              // { version: "v1.0", updateDataModel: { surfaceId, path: "/", value } }
stream.upsert(...surface.components);   // { version: "v1.0", updateComponents: { surfaceId, components } }
stream.close();                         // status "ready"
q.push({ type: "TOOL_CALL_RESULT", toolCallId, messageId, role: "tool",
         content: JSON.stringify({ surface: { surfaceId, components, data } }) });
```

`SurfaceStream` (templates/surface.ts) emits one `generative-ui-surface` activity per surface: an `ACTIVITY_SNAPSHOT` with a `createSurface` operation, then `ACTIVITY_DELTA`s that append operations. The client validates and applies each one as it lands. With `generativeUI: false` on the runtime, nothing converts tool results; the tool result is plain JSON so a later run can find the surface and update it. Writing the data before the components means every binding resolves the moment its component swaps in.

## Lists through templates

Repeat a component per data item instead of generating N components:

```ts
{ id: "list", component: "List", children: { componentId: "flight", path: "/flights" } },
{ id: "flight", component: "FlightCard", airline: p("airline"), price: p("price"),
  onAction: { event: { name: "select_flight", context: { flightNumber: p("flightNumber") } } } },
```

Template paths are relative (no leading slash). A fixed surface can also carry refinement buttons (`{ component: "Button", label: "Nonstop only", onClick: { event: { name: "filter_nonstop" } } }`); the router answers those by updating this surface in place (dynamic-schema.md).

## When the router supplies the data

Some frequent asks have no API (a receipt, a profile, a recipe). Make the tool's parameters the data and keep the tree fixed:

```ts
{ name: "show_receipt", parameters: obj({ merchant: str(""), items: arr(obj({ name, qty, price })), tax: num("") }, [...]),
  run: async (a) => receiptSurface(a) }
```

Router output is ~100 to 300 tokens of data, so these paint in ~2.5 s, still faster and more consistent than composing.

## Data honesty

Label sources in the surface (a `Caption` bound to `/source`). When no keyless API exists (stocks, flights here), generate deterministic sample data and show a visible "Sample data" badge. Cache API responses in memory (15 min TTL here): Open-Meteo, Nominatim and OSRM vary from 0.3 to 4 s per call. If the fetch fails, upsert `root` as an `Alert` explaining why, so the skeleton never stays on screen.

## Measured (a2ui-playground, v0.9 build of the same pipeline)

| Fixed tool | First paint |
| --- | --- |
| show_flights / show_stock (template + sample data) | 1.35 to 1.4 s |
| show_signup_form | 1.8 s |
| show_fx (Frankfurter) | 2.1 s |
| show_route (OSRM) | 2.7 s |
| show_places (Nominatim) | 2.7 to 2.9 s |
| show_weather (Open-Meteo, cold) | 3.3 to 5.8 s |

The floor is router latency (gpt-5.5, `reasoning_effort: "none"`, median 1.25 s to the tool decision).
