import { redirect } from "next/navigation";
import { defaultSkinId } from "@/shell/skins-config";

// The app is multi-skin; `/` has no content of its own. Redirect to the default
// skin's root. Imports pure config (no client skin modules) so this stays a
// server component.
export default function RootIndex() {
  redirect(`/${defaultSkinId}`);
}
