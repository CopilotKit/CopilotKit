"use client";

import { useCopilotContext, useCopilotMessagesContext } from "@copilotkit/react-core";
import {
  getPublishedCopilotKitVersion,
  logActions,
  logMessages,
  logReadables,
  shouldShowDevConsole,
} from "./utils";
import React, { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CopilotKitIcon,
  ExclamationMarkIcon,
  ExclamationMarkTriangleIcon,
} from "./icons";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { COPILOTKIT_VERSION } from "@copilotkit/shared";
import { SmallSpinnerIcon } from "../chat/Icons";
import { CopilotKitHelpModal } from "../help-modal";

type VersionStatus = "unknown" | "checking" | "latest" | "update-available" | "outdated";

export function CopilotDevConsole() {
  const currentVersion = COPILOTKIT_VERSION;
  const context = useCopilotContext();

  // to prevent hydration errors, ensure that the component renders the same content
  // server-side as it does during the initial client-side render to prevent a hydration
  // mismatch
  // see: https://nextjs.org/docs/messages/react-hydration-error#solution-1-using-useeffect-to-run-on-the-client-only

  const [showDevConsole, setShowDevConsole] = useState(false);

  useEffect(() => {
    setShowDevConsole(shouldShowDevConsole(context.showDevConsole));
  }, [context.showDevConsole]);

  const dontRunTwiceInDevMode = useRef(false);
  const [versionStatus, setVersionStatus] = useState<VersionStatus>("unknown");
  const [latestVersion, setLatestVersion] = useState<string>("");
  const consoleRef = useRef<HTMLDivElement>(null);
  const [debugButtonMode, setDebugButtonMode] = useState<"full" | "compact">("full");

  const checkForUpdates = (force: boolean = false) => {
    setVersionStatus("checking");

    getPublishedCopilotKitVersion(currentVersion, force)
      .then((v) => {
        setLatestVersion(v.latest);
        let versionOk = false;

        // match exact version or a version with a letter (e.g. 1.0.0-alpha.1)
        if (v.current === v.latest) {
          versionOk = true;
        } else if (/[a-zA-Z]/.test(v.current)) {
          versionOk = true;
        }

        if (versionOk) {
          setVersionStatus("latest");
        } else if (v.severity !== "low") {
          setVersionStatus("outdated");
        } else {
          setVersionStatus("update-available");
        }
      })
      .catch((e) => {
        console.error(e);
        setVersionStatus("unknown");
      });
  };

  useEffect(() => {
    if (dontRunTwiceInDevMode.current === true) {
      return;
    }
    dontRunTwiceInDevMode.current = true;

    checkForUpdates();
  }, []);

  if (!showDevConsole) {
    return null;
  }
  return (
    <div
      ref={consoleRef}
      className={
        "copilotKitDevConsole " +
        (versionStatus === "update-available" ? "copilotKitDevConsoleUpgrade" : "") +
        (versionStatus === "outdated" ? "copilotKitDevConsoleWarnOutdated" : "")
      }
    >
      <VersionInfo
        showDevConsole={context.showDevConsole}
        versionStatus={versionStatus}
        currentVersion={currentVersion}
        latestVersion={latestVersion}
      />

      <CopilotKitHelpModal />

      <DebugMenuButton
        setShowDevConsole={setShowDevConsole}
        checkForUpdates={checkForUpdates}
        mode={debugButtonMode}
      />
    </div>
  );
}

function VersionInfo({
  showDevConsole,
  versionStatus,
  currentVersion,
  latestVersion,
}: {
  showDevConsole: boolean;
  versionStatus: VersionStatus;
  currentVersion: string;
  latestVersion: string;
}) {
  const [copyStatus, setCopyStatus] = useState<string>("");

  let versionLabel = "";
  let versionIcon: any = "";
  let currentVersionLabel = currentVersion;

  if (versionStatus === "latest") {
    versionLabel = "latest";
    versionIcon = CheckIcon;
  } else if (versionStatus === "checking") {
    versionLabel = "checking";
    versionIcon = SmallSpinnerIcon;
  } else if (versionStatus === "update-available") {
    versionLabel = "update available";
    versionIcon = ExclamationMarkIcon;
    currentVersionLabel = `${currentVersion} → ${latestVersion}`;
  } else if (versionStatus === "outdated") {
    versionLabel = "outdated";
    versionIcon = ExclamationMarkTriangleIcon;
    currentVersionLabel = `${currentVersion} → ${latestVersion}`;
  }

  let asideLabel = "";
  if (showDevConsole === true) {
    asideLabel = "(enabled)";
  }

  const installCommand = [
    `npm install`,
    `@copilotkit/react-core@${latestVersion}`,
    `@copilotkit/react-ui@${latestVersion}`,
    `@copilotkit/react-textarea@${latestVersion}`,
    `&& npm install @copilotkit/runtime@${latestVersion}`,
  ].join(" ");

  const handleCopyClick = () => {
    navigator.clipboard.writeText(installCommand.trim()).then(() => {
      setCopyStatus("Command copied to clipboard!");
      setTimeout(() => setCopyStatus(""), 1000);
    });
  };

  if (versionStatus === "update-available" || versionStatus === "outdated") {
    return (
      <div className="copilotKitVersionInfo">
        <p>
          {currentVersionLabel} {versionIcon}
        </p>
        <button onClick={handleCopyClick}>{copyStatus || installCommand}</button>
      </div>
    );
  }

  return null;
}

export default function DebugMenuButton({
  setShowDevConsole,
  checkForUpdates,
  mode,
}: {
  setShowDevConsole: (show: boolean) => void;
  checkForUpdates: (force: boolean) => void;
  mode: "full" | "compact";
}) {
  const context = useCopilotContext();
  const messagesContext = useCopilotMessagesContext();

  return (
    <>
      <Menu>
        <MenuButton
          className={`copilotKitDebugMenuTriggerButton ${mode === "compact" ? "compact" : ""}`}
        >
          {mode == "compact" ? "Debug" : <>Debug {ChevronDownIcon}</>}
        </MenuButton>

        <MenuItems
          transition
          anchor="bottom end"
          className="copilotKitDebugMenu"
          style={{ zIndex: 40 }}
        >
          <MenuItem>
            <button className="copilotKitDebugMenuItem" onClick={() => logReadables(context)}>
              Log Readables
            </button>
          </MenuItem>
          <MenuItem>
            <button className="copilotKitDebugMenuItem" onClick={() => logActions(context)}>
              Log Actions
            </button>
          </MenuItem>
          <MenuItem>
            <button
              className="copilotKitDebugMenuItem"
              onClick={() => logMessages(messagesContext)}
            >
              Log Messages
            </button>
          </MenuItem>
          <MenuItem>
            <button className="copilotKitDebugMenuItem" onClick={() => checkForUpdates(true)}>
              Check for Updates
            </button>
          </MenuItem>
          <hr />
          <MenuItem>
            <button className="copilotKitDebugMenuItem" onClick={() => setShowDevConsole(false)}>
              Hide Dev Console
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>
    </>
  );
}
