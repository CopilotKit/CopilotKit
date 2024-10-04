import { icons as lucideIcons } from "lucide-react";
import { createElement } from "react";
import { customIcons } from "./custom-icons";

export function icon(icon: any) {
  if (!icon) {
    return;
  }

  let iconElement: React.ReactNode = null;

  if (icon.startsWith("lucide/")) {
    const iconName = icon.split("lucide/")[1];
    if (iconName in lucideIcons)
      iconElement = createElement(
        lucideIcons[iconName as keyof typeof lucideIcons]
      );
  }

  if (icon.startsWith("custom/")) {
    const iconName = icon.split("custom/")[1];
    if (iconName in customIcons)
      iconElement = createElement(
        customIcons[iconName as keyof typeof customIcons]
      );
  }

  return (
    <div className="border border-fd-primary/10 rounded-md p-1.5 bg-gradient-to-b from-fd-muted/40 to-fd-muted/80 text-primary">
      {iconElement}
    </div>
  );
}
