<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  DEFAULT_DARK_MAP_STYLE,
  DEFAULT_MAP_STYLE,
  FONT_WEIGHT,
  MAP_CSS,
  MAP_STYLE_ID,
  ROUTE_SOURCE,
  backgroundColor,
  borderColor,
  guardStyleFilters,
  isMapLibre,
  isValidMarker,
  jsonEqual,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type {
  MapLibre,
  MapLibreMap,
  MapMarker,
  mapSchema,
} from "@copilotkit/shared/generative-ui";
import { useGenerativeUIRuntime } from "../../../runtime-context";
import {
  GENERATIVE_UI_MAP_LOADER,
  useGenerativeUILibrary,
} from "../../loaders";
import { useStandardStyles } from "../../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIMap" });

type MapProps = z.output<typeof mapSchema>;

/**
 * A MapLibre map with markers. The `/map` plugin (`app.use(GenerativeUIMap)`)
 * provides maplibre-gl. Without it, or without WebGL, the component shows a
 * list of the places. A click on a place or a marker sets `selected`.
 *
 * The map is created in the browser only, after the component mounts, so
 * the server renders the list.
 */
const props = defineProps<{
  markers?: MapProps["markers"];
  /** Draws a line through the markers, in order. */
  route?: MapProps["route"];
  /** The height of the map and of the list, in pixels. Default 240. */
  height?: MapProps["height"];
  /** With two or more markers, only the highest zoom of the fit. */
  zoom?: MapProps["zoom"];
  center?: MapProps["center"];
}>();

/** The label of the selected marker. Writable: a pick emits `update:selected`. */
const selected = defineModel<MapProps["selected"]>("selected");

useStandardStyles();
const { library, status: libraryStatus } = useGenerativeUILibrary(
  GENERATIVE_UI_MAP_LOADER,
);
const runtime = useGenerativeUIRuntime();
const container = useTemplateRef<HTMLDivElement>("container");
/** Whether a map was created from the loaded library. */
const mapState = ref<"loading" | "ready" | "failed">("loading");
const isDark = ref(false);

const status = computed(() => {
  const isFallback =
    libraryStatus.value === "none" ||
    libraryStatus.value === "failed" ||
    mapState.value === "failed";
  if (isFallback) return "fallback";
  return mapState.value;
});

/** The value of `getter`. A new value with the same JSON keeps the old one. */
function jsonStable<Value>(getter: () => Value) {
  return computed<Value>((previous) => {
    const next = getter();
    return previous !== undefined && jsonEqual(previous, next)
      ? previous
      : next;
  });
}

const validMarkers = jsonStable(() =>
  (props.markers ?? []).filter(isValidMarker),
);
const center = jsonStable(() => props.center);
const heightPx = computed(() => `${props.height ?? 240}px`);

/** A top-level style applies in both modes. `dark.mapStyle` wins in dark mode. */
const styleUrl = computed(() => {
  const theme = runtime.value?.theme;
  return isDark.value
    ? theme?.dark?.mapStyle || theme?.mapStyle || DEFAULT_DARK_MAP_STYLE
    : theme?.mapStyle || DEFAULT_MAP_STYLE;
});

const STYLE: CSSProperties = {
  position: "relative",
  width: "100%",
  border: `1px solid ${borderColor("default")}`,
  borderRadius: radius("lg"),
  overflow: "hidden",
  background: backgroundColor("surface-secondary"),
};
const LABEL_STYLE: CSSProperties = { fontWeight: FONT_WEIGHT.medium };
const COORDINATES_STYLE: CSSProperties = {
  ...textFont("xs"),
  color: textColor("secondary"),
};
const containerStyle = computed<CSSProperties>(() => ({
  height: heightPx.value,
  width: "100%",
  display: status.value === "fallback" ? "none" : "block",
}));
const placesStyle = computed<CSSProperties>(() => ({
  listStyle: "none",
  margin: 0,
  padding: spacing(3),
  display: "flex",
  flexDirection: "column",
  gap: spacing(2),
  maxHeight: heightPx.value,
  overflowY: "auto",
  boxSizing: "border-box",
}));

function placeStyle(isSelected: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "baseline",
    gap: spacing(2),
    width: "100%",
    minHeight: "24px",
    textAlign: "start",
    border: 0,
    padding: `${spacing(1)} ${spacing(2)}`,
    borderRadius: radius("md"),
    background: isSelected ? backgroundColor("info") : "transparent",
    cursor: "pointer",
    color: textColor("default"),
  };
}

/** The maplibre-gl module. A UMD bundle can put its exports on `default`. */
function resolveMapLibre(module: unknown) {
  const fromDefault: unknown =
    typeof module === "object" && module !== null && "default" in module
      ? module.default
      : undefined;
  if (isMapLibre(fromDefault)) return fromDefault;
  return isMapLibre(module) ? module : null;
}

interface MapContent {
  element: HTMLElement;
  markers: MapMarker[];
  zoom: number | undefined;
  route: boolean;
  styleUrl: string;
}

/** Adds the style, the markers, the fit and the route to a new map. */
function drawMap(maplibregl: MapLibre, map: MapLibreMap, content: MapContent) {
  const { element, markers, zoom, route } = content;
  // `transformStyle` is an option of setStyle, not of the constructor.
  map.setStyle(content.styleUrl, {
    transformStyle: (_previous, next) => guardStyleFilters(next),
  });
  for (const marker of markers) {
    const pin = new maplibregl.Marker()
      .setLngLat([marker.lng, marker.lat])
      .setPopup(new maplibregl.Popup({ offset: 24 }).setText(marker.label))
      .addTo(map);
    pin
      .getElement()
      .addEventListener("click", () => (selected.value = marker.label));
  }
  // With two or more markers, the map always shows all of them. The fit
  // needs the size of the container, which settles after the map mounts,
  // so it runs again on each resize, until the user moves the map.
  let hasUserMoved = false;
  map.on("dragstart", () => {
    hasUserMoved = true;
  });
  map.on("zoomstart", (event) => {
    if (event.originalEvent) hasUserMoved = true;
  });
  const fitMarkers = () => {
    const isTooSmall = element.clientWidth < 10 || element.clientHeight < 10;
    if (markers.length < 2 || hasUserMoved || isTooSmall) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const marker of markers) bounds.extend([marker.lng, marker.lat]);
    map.fitBounds(bounds, { padding: 48, maxZoom: zoom ?? 14, duration: 0 });
  };
  fitMarkers();
  map.on("load", fitMarkers);
  map.on("resize", fitMarkers);
  if (!route || markers.length < 2) return;
  map.on("load", () => {
    if (map.getSource(ROUTE_SOURCE)) return;
    map.addSource(ROUTE_SOURCE, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: markers.map((marker) => [marker.lng, marker.lat]),
        },
      },
    });
    map.addLayer({
      id: ROUTE_SOURCE,
      type: "line",
      source: ROUTE_SOURCE,
      paint: { "line-color": "#0285ff", "line-width": 3 },
    });
  });
}

function removeMap(map: MapLibreMap | undefined) {
  try {
    map?.remove();
  } catch {
    // The map is already removed.
  }
}

// A new map for each change of the markers, the view or the style. The
// library only loads after the component mounts, so this never runs on the
// server.
watch(
  [
    library,
    container,
    validMarkers,
    center,
    () => props.zoom,
    () => props.route,
    styleUrl,
  ],
  ([module, element, markers, start, zoom, route, style], _, onCleanup) => {
    if (module === null || element === null) return;
    const maplibregl = resolveMapLibre(module);
    if (maplibregl === null) {
      mapState.value = "failed";
      return;
    }
    let map: MapLibreMap | undefined;
    try {
      const focus = start ?? markers[0];
      map = new maplibregl.Map({
        container: element,
        center: focus ? [focus.lng, focus.lat] : [0, 20],
        zoom: zoom ?? (markers.length === 1 ? 10 : 1),
        attributionControl: { compact: true },
        // The map is in a chat that scrolls. A plain wheel scrolls the page.
        // Ctrl or Cmd + wheel (two fingers on touch) zooms the map.
        cooperativeGestures: true,
      });
      drawMap(maplibregl, map, {
        element,
        markers,
        zoom,
        route: route === true,
        styleUrl: style,
      });
      mapState.value = "ready";
    } catch {
      // There is no WebGL, or the map failed to draw.
      removeMap(map);
      map = undefined;
      mapState.value = "failed";
    }
    onCleanup(() => removeMap(map));
  },
  { flush: "post" },
);

let observer: MutationObserver | undefined;

onMounted(() => {
  if (!document.getElementById(MAP_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = MAP_STYLE_ID;
    style.textContent = MAP_CSS;
    document.head.appendChild(style);
  }
  if (libraryStatus.value === "none") return;
  // Dark mode: the map, or an ancestor, has the `dark` class. One observer
  // for each map, on every class change in the document.
  const check = () => {
    isDark.value = Boolean(container.value?.closest(".dark"));
  };
  check();
  observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
    subtree: true,
  });
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div data-a2ui-std="" :data-a2ui-map="status" :style="STYLE">
    <div ref="container" aria-hidden="true" :style="containerStyle" />
    <ul
      class="a2ui-std-list a2ui-std-map-places"
      role="list"
      aria-label="Map places"
      :data-collapsed="status === 'fallback' ? undefined : ''"
      :style="placesStyle"
    >
      <li
        v-for="(marker, index) in validMarkers"
        :key="`${marker.label}-${index}`"
      >
        <button
          type="button"
          data-a2ui-input=""
          :aria-pressed="selected === marker.label"
          :style="placeStyle(selected === marker.label)"
          @click="selected = marker.label"
        >
          <!-- The space keeps the label and the coordinates apart as text. -->
          <span :style="LABEL_STYLE">{{ marker.label }}</span
          >{{ " " }}
          <span :style="COORDINATES_STYLE">
            {{ marker.lat.toFixed(4) }}, {{ marker.lng.toFixed(4)
            }}{{ marker.category ? ` · ${marker.category}` : "" }}
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>
