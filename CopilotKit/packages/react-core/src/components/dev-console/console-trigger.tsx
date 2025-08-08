"use client";

import React, { useState, useEffect, useRef } from "react";
import { useCopilotContext } from "../../context/copilot-context";
import { CopilotKitIcon } from "./icons";
import { DeveloperConsoleModal } from "./developer-console-modal";

interface ConsoleTriggerProps {
  position?: "bottom-left" | "bottom-right";
}

export function ConsoleTrigger({ position = "bottom-right" }: ConsoleTriggerProps) {
  const context = useCopilotContext();
  const hasApiKey = Boolean(context.copilotApiConfig.publicApiKey);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [buttonPosition, setButtonPosition] = useState<{ x: number; y: number } | null>(null);
  const [mounted, setMounted] = useState(false);

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
    if (typeof window !== "undefined" && !buttonPosition) {
      const buttonSize = 60;
      const margin = 24;

      const initialPosition = {
        x: margin,
        y: window.innerHeight - buttonSize - margin,
      };

      setButtonPosition(initialPosition);
    }
  }, [position]);

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
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!dragRef.current) return;

      const deltaX = e.clientX - dragRef.current.startX;
      const deltaY = e.clientY - dragRef.current.startY;

      // Calculate new position
      let newX = dragRef.current.buttonX + deltaX;
      let newY = dragRef.current.buttonY + deltaY;

      // Keep button within viewport bounds
      newX = Math.max(0, Math.min(newX, window.innerWidth - 60));
      newY = Math.max(0, Math.min(newY, window.innerHeight - 60));

      setButtonPosition({ x: newX, y: newY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragRef.current = null;
    };

    // Use capture phase to intercept events before they reach other handlers
    document.addEventListener("mousemove", handleMouseMove, { capture: true, passive: false });
    document.addEventListener("mouseup", handleMouseUp, { capture: true, passive: false });

    return () => {
      document.removeEventListener("mousemove", handleMouseMove, { capture: true });
      document.removeEventListener("mouseup", handleMouseUp, { capture: true });
    };
  }, [isDragging]);

  // Don't render until mounted and position is initialized
  if (!mounted || !buttonPosition) {
    return null;
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => {
          if (!isDragging) {
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
          width: "60px",
          height: "60px",
          background: isDragging ? "#000000" : isHovered ? "#111111" : "#000000",
          color: "white",
          borderRadius: "50%",
          boxShadow: isDragging
            ? "0 8px 32px rgba(0, 0, 0, 0.6), 0 4px 16px rgba(0, 0, 0, 0.4)"
            : isHovered
              ? "0 12px 40px rgba(0, 0, 0, 0.7), 0 6px 20px rgba(0, 0, 0, 0.5)"
              : "0 6px 20px rgba(0, 0, 0, 0.5), 0 3px 10px rgba(0, 0, 0, 0.3)",
          transition: isDragging ? "none" : "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          cursor: isDragging ? "grabbing" : "grab",
          opacity: 1,
          userSelect: "none",
          transform: isDragging ? "scale(1.05)" : isHovered ? "scale(1.1)" : "scale(1)",
          backdropFilter: "blur(10px)",
          pointerEvents: "auto",
          isolation: "isolate",
        }}
        title={
          hasApiKey
            ? "Open Inspector (Drag to move)"
            : "Inspector (License Key Required, Drag to move)"
        }
      >
        <div
          style={{
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))",
          }}
        >
          <CopilotKitIcon />
        </div>
        {!hasApiKey && (
          <div
            style={{
              position: "absolute",
              top: "-2px",
              right: "-2px",
              width: "18px",
              height: "18px",
              background: "linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 8px rgba(255, 107, 107, 0.4)",
              border: "2px solid white",
            }}
          >
            <span style={{ fontSize: "10px", color: "white", fontWeight: "bold" }}>!</span>
          </div>
        )}
      </button>

      <DeveloperConsoleModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        hasApiKey={hasApiKey}
      />
    </>
  );
}
