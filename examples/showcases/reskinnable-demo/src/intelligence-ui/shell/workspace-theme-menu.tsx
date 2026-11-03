/* eslint-disable react-hooks/set-state-in-effect -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuTrigger,
} from "../ui/overlays";
import { Button } from "../ui/primitives";

import { useWorkspaceTheme } from "./workspace-theme";

/** The selected reference's Sun/Moon menu with Radix radio semantics. */
export function WorkspaceThemeMenu(): React.JSX.Element {
  const { preference, resolvedTheme, setPreference } = useWorkspaceTheme();
  // Demo: Next renders this on the server first, where the saved theme is
  // unknown; draw the saved theme's icon from the first client render on.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const Icon = mounted && resolvedTheme === "dark" ? Moon : Sun;

  return (
    <MenuRoot modal={false}>
      <MenuTrigger asChild>
        <Button
          aria-label="Choose theme"
          className="workspace-theme-trigger"
          size="icon-sm"
          variant="ghost"
        >
          <Icon aria-hidden="true" size={16} />
        </Button>
      </MenuTrigger>
      <MenuContent
        align="end"
        aria-label="Theme"
        className="workspace-theme-menu"
      >
        <MenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            if (value === "light" || value === "dark" || value === "system") {
              setPreference(value);
            }
          }}
        >
          <MenuRadioItem value="light">
            <Sun aria-hidden="true" />
            Light mode
          </MenuRadioItem>
          <MenuRadioItem value="dark">
            <Moon aria-hidden="true" />
            Dark mode
          </MenuRadioItem>
          <MenuRadioItem value="system">
            <Monitor aria-hidden="true" />
            System
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot>
  );
}
