import { useState } from "react";
import { ActionButton } from "./ActionButton";
import { SpeakerWaveIcon } from "@heroicons/react/24/outline";
import { resetGlobalAudio, speak } from "../../utils/globalAudio";

interface SpeakCurrentSlideButtonProps {
  spokenNarration: string;
}

export function SpeakCurrentSlideButton({ spokenNarration }: SpeakCurrentSlideButtonProps) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  return (
    <ActionButton inProgress={isSpeaking}>
      <SpeakerWaveIcon
        className="h-5 w-5"
        onClick={async () => {
          resetGlobalAudio();
          try {
            setIsSpeaking(true);
            await speak(spokenNarration);
          } finally {
            setIsSpeaking(false);
          }
        }}
      />
    </ActionButton>
  );
}
