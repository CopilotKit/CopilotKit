"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { Check } from "lucide-react";

/**
 * Schema for the attachMeetingNotes frontend tool. The LLM (or fixture) passes
 * a filename + size + imageUrl; the component animates an "attaching... ->
 * attached" header strip and reveals the actual image inline.
 *
 * This is a demo-only visual: in mock mode the fixture hardcodes the image
 * path. The animation is purely time-based (not gated on streaming status) so
 * it plays consistently regardless of how the fixture streams the args.
 */
export const AttachMeetingNotesProps = z.object({
  filename: z
    .string()
    .describe("Display filename, e.g. Sprint 52 Planning Notes.png"),
  size: z.string().describe("Display size, e.g. 2.3 MB. Purely cosmetic."),
  imageUrl: z
    .string()
    .describe(
      "Public URL or absolute path to the image to display, e.g. /sprint-52.png",
    ),
});

export type AttachMeetingNotesArgs = z.infer<typeof AttachMeetingNotesProps>;

const ATTACH_DURATION_MS = 1200;

export function AttachMeetingNotes({
  filename,
  size,
  imageUrl,
}: AttachMeetingNotesArgs) {
  const [phase, setPhase] = useState<"attaching" | "attached">("attaching");

  useEffect(() => {
    const t = setTimeout(() => setPhase("attached"), ATTACH_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="max-w-md w-full"
      style={{
        background: "rgba(255, 255, 255, 0.65)",
        border: "2px solid #ffffff",
        borderRadius: 10,
        padding: 10,
        marginBottom: 8,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        boxShadow: "0px 1px 3px 0px rgba(1, 5, 7, 0.08)",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes attachShimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(220%); }
        }
        @keyframes attachCheckPop {
          0% { transform: scale(0); opacity: 0; }
          60% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes attachImageReveal {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <div className="min-w-0 flex-1">
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#010507",
              lineHeight: 1.25,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {filename}
          </div>
          <div
            className="flex items-center gap-1.5"
            style={{ fontSize: 11, color: "#57575b", marginTop: 2 }}
          >
            {size && <span>{size}</span>}
            {size && <span style={{ color: "#dbdbe5" }}>·</span>}
            {phase === "attaching" ? (
              <span>Attaching…</span>
            ) : (
              <span
                className="inline-flex items-center gap-1"
                style={{ color: "#189370", fontWeight: 500 }}
              >
                <span
                  className="inline-flex items-center justify-center rounded-full"
                  style={{
                    width: 12,
                    height: 12,
                    background: "#189370",
                    animation:
                      "attachCheckPop 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                >
                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                </span>
                Attached
              </span>
            )}
          </div>
        </div>
      </div>

      {phase === "attaching" && (
        <div
          style={{
            height: 4,
            background: "rgba(190, 194, 255, 0.25)",
            borderRadius: 999,
            overflow: "hidden",
            position: "relative",
            marginBottom: 8,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: "45%",
              background:
                "linear-gradient(90deg, transparent 0%, #bec2ff 50%, transparent 100%)",
              animation: "attachShimmer 1.2s ease-in-out infinite",
              borderRadius: 999,
            }}
          />
        </div>
      )}

      {imageUrl && (
        <img
          src={imageUrl}
          alt={filename}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            maxHeight: 360,
            objectFit: "contain",
            background: "#ffffff",
            border: "1px solid #dbdbe5",
            borderRadius: 6,
            opacity: phase === "attached" ? 1 : 0.55,
            filter: phase === "attached" ? "none" : "blur(3px)",
            transition: "opacity 320ms ease-out, filter 320ms ease-out",
            animation:
              phase === "attached"
                ? "attachImageReveal 0.32s ease-out"
                : undefined,
          }}
        />
      )}
    </div>
  );
}
