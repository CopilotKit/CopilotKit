"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { LayerCard, Text as KumoText } from "@cloudflare/kumo";
import type { StandardProps } from "./types";

const FACE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  minHeight: "140px",
  padding: "16px",
  textAlign: "center",
};

/**
 * FlashcardFlip: two Kumo LayerCard faces that turn over on a click (or
 * Enter or Space, since it is a button). The turn is CSS in ./kumo.css,
 * and it is instant when the system asks for reduced motion. Screen
 * readers hear only the face that shows.
 */
export function FlashcardFlip(props: StandardProps<"FlashcardFlip">) {
  const [isFlipped, setIsFlipped] = useState(false);
  return (
    <button
      type="button"
      className="kumo-flashcard"
      aria-pressed={isFlipped}
      onClick={() => setIsFlipped((current) => !current)}
    >
      <span className="kumo-flashcard-inner">
        <LayerCard
          render={<span />}
          className="kumo-flashcard-face"
          aria-hidden={isFlipped}
          style={FACE}
        >
          <KumoText variant="heading" as="span">
            {props.front}
          </KumoText>
          {props.hint ? (
            <KumoText variant="secondary" size="sm" as="span">
              {props.hint}
            </KumoText>
          ) : null}
        </LayerCard>
        <LayerCard
          render={<span />}
          className="kumo-flashcard-face kumo-flashcard-back"
          aria-hidden={!isFlipped}
          style={FACE}
        >
          <KumoText variant="heading" as="span">
            {props.back}
          </KumoText>
        </LayerCard>
      </span>
    </button>
  );
}

export const feedbackOverrides = {
  FlashcardFlip: { component: FlashcardFlip },
};
