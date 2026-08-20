import type { NativeNodeKind } from "@copilotkit/channels-ui";

export type DiscordNativeSurface = "message" | "modal" | "object";

export interface DiscordCatalogEntry {
  readonly component: string;
  readonly nativeType: string;
  readonly componentType?: number;
  readonly kind: NativeNodeKind;
  readonly surface: DiscordNativeSurface;
  readonly childrenSlot?: string;
  readonly source: string;
}

const SOURCE = "https://docs.discord.com/developers/components/reference";

type ComponentManifestRow = readonly [
  component: string,
  nativeType: string,
  componentType: number,
  kind: NativeNodeKind,
  childrenSlot?: string,
];

type ObjectManifestRow = readonly [
  component: string,
  nativeType: string,
  kind: "object",
];

/** Stable Components V2 types documented for message payloads. */
export const DISCORD_MESSAGE_MANIFEST = [
  ["ActionRow", "action_row", 1, "layout", "components"],
  ["Button", "button", 2, "action"],
  ["StringSelect", "string_select", 3, "action", "options"],
  ["UserSelect", "user_select", 5, "action"],
  ["RoleSelect", "role_select", 6, "action"],
  ["MentionableSelect", "mentionable_select", 7, "action"],
  ["ChannelSelect", "channel_select", 8, "action"],
  ["Section", "section", 9, "layout", "components"],
  ["TextDisplay", "text_display", 10, "element"],
  ["Thumbnail", "thumbnail", 11, "element"],
  ["MediaGallery", "media_gallery", 12, "element", "items"],
  ["File", "file", 13, "element"],
  ["Separator", "separator", 14, "layout"],
  ["Container", "container", 17, "layout", "components"],
] as const satisfies readonly ComponentManifestRow[];

/** Stable component types documented for modal payloads. */
export const DISCORD_MODAL_MANIFEST = [
  ["TextDisplay", "text_display", 10, "element"],
  ["Label", "label", 18, "layout", "component"],
  ["TextInput", "text_input", 4, "input"],
  ["StringSelect", "string_select", 3, "input", "options"],
  ["UserSelect", "user_select", 5, "input"],
  ["RoleSelect", "role_select", 6, "input"],
  ["MentionableSelect", "mentionable_select", 7, "input"],
  ["ChannelSelect", "channel_select", 8, "input"],
  ["FileUpload", "file_upload", 19, "input"],
  ["RadioGroup", "radio_group", 21, "input", "options"],
  ["CheckboxGroup", "checkbox_group", 22, "input", "options"],
  ["Checkbox", "checkbox", 23, "input"],
] as const satisfies readonly ComponentManifestRow[];

/** Typed composition objects accepted by stable Discord components. */
export const DISCORD_OBJECT_MANIFEST = [
  ["SelectOption", "select_option", "object"],
  ["MediaItem", "media_item", "object"],
  ["UnfurledMediaItem", "unfurled_media_item", "object"],
  ["RadioOption", "radio_option", "object"],
  ["CheckboxOption", "checkbox_option", "object"],
] as const satisfies readonly ObjectManifestRow[];

function entries(
  rows: readonly ComponentManifestRow[],
  surface: "message" | "modal",
): DiscordCatalogEntry[] {
  return rows.map(
    ([component, nativeType, componentType, kind, childrenSlot]) => ({
      component,
      nativeType,
      componentType,
      kind,
      surface,
      ...(childrenSlot ? { childrenSlot } : {}),
      source: SOURCE,
    }),
  );
}

/** Reviewed stable Discord component and object catalog. */
export const DISCORD_NATIVE_MANIFEST: readonly DiscordCatalogEntry[] = [
  ...entries(DISCORD_MESSAGE_MANIFEST, "message"),
  ...entries(DISCORD_MODAL_MANIFEST, "modal"),
  ...DISCORD_OBJECT_MANIFEST.map(([component, nativeType, kind]) => ({
    component,
    nativeType,
    kind,
    surface: "object" as const,
    source: SOURCE,
  })),
];
