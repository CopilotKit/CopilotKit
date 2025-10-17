"use client";

import React, { useState, useEffect, useRef } from "react";
import { useCopilotContext } from "../../context/copilot-context";
import { CopilotKitIcon } from "./icons";
import { DeveloperConsoleModal } from "./developer-console-modal";
import { InspectorMessage } from "./types";
import {
  fetchNotifications,
  countUnreadNotifications,
  type Notification,
} from "../../utils/notifications";

// Storage key for hiding the Inspector trigger/modal (with timestamp)
const INSPECTOR_HIDE_KEY = "cpk:inspector:hidden";
// Session storage key for temporary hiding (until browser refresh)
const INSPECTOR_HIDE_SESSION_KEY = "cpk:inspector:hidden:session";

interface ConsoleTriggerProps {
  position?: "bottom-left" | "bottom-right";
  inspectorMessages?: InspectorMessage[];
}

export function ConsoleTrigger({
  position = "bottom-right",
  inspectorMessages = [],
}: ConsoleTriggerProps) {
  const context = useCopilotContext();
  const hasApiKey = Boolean(context.copilotApiConfig.publicApiKey);

  // Notification state
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [buttonPosition, setButtonPosition] = useState<{ x: number; y: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    buttonX: number;
    buttonY: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Initialize on client side only
  useEffect(() => {
    setMounted(true);
    try {
      // Clear session storage on mount (fresh page load)
      // Session storage is meant to only hide until browser refresh/close
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(INSPECTOR_HIDE_SESSION_KEY);
      }

      // Check local storage for long-term hide (with timestamp)
      const hidden =
        typeof window !== "undefined" ? localStorage.getItem(INSPECTOR_HIDE_KEY) : null;
      if (hidden) {
        const hideUntil = parseInt(hidden, 10);
        if (!isNaN(hideUntil) && Date.now() < hideUntil) {
          setIsHidden(true);
        } else if (isNaN(hideUntil)) {
          // Old format, clear it
          localStorage.removeItem(INSPECTOR_HIDE_KEY);
        } else if (Date.now() >= hideUntil) {
          // Expired, clear it
          localStorage.removeItem(INSPECTOR_HIDE_KEY);
        }
      }
    } catch {
      // ignore
    }
    if (typeof window !== "undefined" && !buttonPosition) {
      const buttonSize = 36;
      const margin = 24; // Match chat button spacing

      const initialPosition = {
        x: window.innerWidth - buttonSize - margin,
        y: window.innerHeight - buttonSize - margin - 60,
      };

      setButtonPosition(initialPosition);
    }
  }, [position]);

  // Load notifications on mount
  useEffect(() => {
    const loadNotifications = async () => {
      try {
        // TODO: Accept RSS feed URL as prop and pass it here
        const notifs = await fetchNotifications();
        setNotifications(notifs);
        setUnreadCount(countUnreadNotifications(notifs));
      } catch (error) {
        console.debug("Failed to load notifications:", error);
      }
    };

    if (mounted) {
      loadNotifications();
    }
  }, [mounted]);

  const snapToEdge = (position: { x: number; y: number }) => {
    const buttonSize = 36;
    const margin = 24; // Match chat button spacing
    const chatButtonOffset = 80; // Extra offset to avoid CopilotKit chat button

    let snappedX = position.x;
    let snappedY = position.y;

    // Always snap to closest horizontal edge (left or right)
    const distanceFromLeft = position.x;
    const distanceFromRight = window.innerWidth - (position.x + buttonSize);

    const snapRight = distanceFromLeft >= distanceFromRight;

    if (snapRight) {
      snappedX = window.innerWidth - buttonSize - margin;
    } else {
      snappedX = margin;
    }

    // Always snap to closest vertical edge (top or bottom)
    const distanceFromTop = position.y;
    const distanceFromBottom = window.innerHeight - (position.y + buttonSize);

    const snapBottom = distanceFromTop >= distanceFromBottom;

    if (snapBottom) {
      // If snapping to bottom corners, add extra offset to avoid chat button (right) or Next.js icon (left)
      snappedY = window.innerHeight - buttonSize - margin - chatButtonOffset;
    } else {
      snappedY = margin;
    }

    setButtonPosition({ x: snappedX, y: snappedY });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!buttonPosition) return;

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      buttonX: buttonPosition.x,
      buttonY: buttonPosition.y,
    };
    setIsDragging(true);
    setHasDragged(false);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!dragRef.current) return;

      const deltaX = e.clientX - dragRef.current.startX;
      const deltaY = e.clientY - dragRef.current.startY;

      // If moved more than 5px, mark as dragged
      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        setHasDragged(true);
      }

      // Calculate new position
      let newX = dragRef.current.buttonX + deltaX;
      let newY = dragRef.current.buttonY + deltaY;

      // Keep button within viewport bounds
      newX = Math.max(0, Math.min(newX, window.innerWidth - 36));
      newY = Math.max(0, Math.min(newY, window.innerHeight - 36));

      setButtonPosition({ x: newX, y: newY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragRef.current = null;

      // Snap to edges
      if (buttonPosition) {
        snapToEdge(buttonPosition);
      }
    };

    // Use capture phase to intercept events before they reach other handlers
    document.addEventListener("mousemove", handleMouseMove, { capture: true, passive: false });
    document.addEventListener("mouseup", handleMouseUp, { capture: true, passive: false });

    return () => {
      document.removeEventListener("mousemove", handleMouseMove, { capture: true });
      document.removeEventListener("mouseup", handleMouseUp, { capture: true });
    };
  }, [isDragging, buttonPosition]);

  // Don't render until mounted and position is initialized
  if (!mounted || !buttonPosition || isHidden) {
    return null;
  }

  return (
    <>
      {!isModalOpen && (
        <button
          ref={buttonRef}
          onClick={(e) => {
            if (!hasDragged) {
              setIsModalOpen(true);
            }
          }}
          onMouseDown={handleMouseDown}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            position: "fixed",
            left: `${buttonPosition.x}px`,
            top: `${buttonPosition.y}px`,
            zIndex: 2147483647,
            width: "36px",
            height: "36px",
            background: isDragging ? "#000000" : isHovered ? "#1a1a1a" : "#000000",
            color: "white",
            borderRadius: "50%",
            boxShadow: "none",
            transition: isDragging ? "none" : "all 0.2s ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            cursor: isDragging ? "grabbing" : "grab",
            opacity: 1,
            userSelect: "none",
            transform: "scale(1)",
            pointerEvents: "auto",
          }}
          title={
            hasApiKey
              ? "Open Inspector (Drag to move)"
              : "Inspector (License Key Required, Drag to move)"
          }
        >
          {/* Notification slot - shows warning icon when version is outdated */}
          {/* This will be populated with notification data */}
          <div
            style={{
              width: "20px",
              height: "20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CopilotKitIcon />
          </div>

          {/* Notification badge - shows unread count */}
          {unreadCount > 0 && (
            <div
              style={{
                position: "absolute",
                top: "-4px",
                right: "-4px",
                backgroundColor: "#3b82f6",
                color: "white",
                fontSize: "10px",
                fontWeight: "600",
                padding: "2px 5px",
                borderRadius: "10px",
                minWidth: "16px",
                height: "16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1.5px solid #000000",
                boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
              }}
            >
              {unreadCount}
            </div>
          )}
        </button>
      )}

      <DeveloperConsoleModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onHideForDay={() => {
          try {
            const hideUntil = Date.now() + 24 * 60 * 60 * 1000; // 24 hours from now
            localStorage.setItem(INSPECTOR_HIDE_KEY, hideUntil.toString());
          } catch {
            // ignore
          }
          setIsHidden(true);
          setIsModalOpen(false);
        }}
        hasApiKey={hasApiKey}
        buttonPosition={buttonPosition}
        inspectorMessages={inspectorMessages}
      />
    </>
  );
}
