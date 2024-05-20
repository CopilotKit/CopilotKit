import { CopilotContextParams, useCopilotContext } from "@copilotkit/react-core";
import { Message } from "@copilotkit/shared";
import { MutableRefObject, useEffect, useRef, useState } from "react";

export const checkMicrophonePermission = async () => {
  try {
    const permissionStatus = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    if (permissionStatus.state === "granted") {
      return true;
    } else {
      return false;
    }
  } catch (err) {
    console.error("Error checking microphone permission", err);
  }
};

export const requestMicAndPlaybackPermission = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new window.AudioContext();
    await audioContext.resume();
    return { stream, audioContext };
  } catch (err) {
    console.error("Error requesting microphone and playback permissions", err);
    return null;
  }
};

const startRecording = async (
  mediaStreamRef: MutableRefObject<MediaStream | null>,
  mediaRecorderRef: MutableRefObject<MediaRecorder | null>,
  audioContextRef: MutableRefObject<AudioContext | null>,
  recordedChunks: Blob[],
  onStop: () => void,
) => {
  if (!mediaStreamRef.current || !audioContextRef.current) {
    mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContextRef.current = new window.AudioContext();
    await audioContextRef.current.resume();
  }

  mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current!);
  mediaRecorderRef.current.start(1000);
  mediaRecorderRef.current.ondataavailable = (event) => {
    recordedChunks.push(event.data);
  };
  mediaRecorderRef.current.onstop = onStop;
};

const stopRecording = (mediaRecorderRef: MutableRefObject<MediaRecorder | null>) => {
  if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
    mediaRecorderRef.current.stop();
  }
};

const transcribeAudio = async (recordedChunks: Blob[], transcribeAudioUrl: string) => {
  const completeBlob = new Blob(recordedChunks, { type: "audio/mp4" });
  const formData = new FormData();
  formData.append("file", completeBlob, "recording.mp4");

  const response = await fetch(transcribeAudioUrl, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Error: ${response.statusText}`);
  }

  const transcription = await response.json();
  return transcription.text;
};

const playAudioResponse = (text: string, textToSpeechUrl: string, audioContext: AudioContext) => {
  const encodedText = encodeURIComponent(text);
  const url = `${textToSpeechUrl}?text=${encodedText}`;

  fetch(url)
    .then((response) => response.arrayBuffer())
    .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
    .then((audioBuffer) => {
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);
    })
    .catch((error) => {
      console.error("Error with decoding audio data", error);
    });
};

export type PushToTalkState = "idle" | "recording" | "transcribing";

export type SendFunction = (text: string) => Promise<Message>;

export const usePushToTalk = ({
  sendFunction,
  inProgress,
}: {
  sendFunction: SendFunction;
  inProgress: boolean;
}) => {
  const [pushToTalkState, setPushToTalkState] = useState<PushToTalkState>("idle");
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunks = useRef<Blob[]>([]);
  const context = useCopilotContext();
  const [startReadingFromMessageId, setStartReadingFromMessageId] = useState<string | null>(null);

  useEffect(() => {
    if (pushToTalkState === "recording") {
      startRecording(
        mediaStreamRef,
        mediaRecorderRef,
        audioContextRef,
        recordedChunks.current,
        () => {
          setPushToTalkState("transcribing");
        },
      );
    } else {
      stopRecording(mediaRecorderRef);
      if (pushToTalkState === "transcribing") {
        transcribeAudio(recordedChunks.current, context.copilotApiConfig.transcribeAudioUrl!).then(
          async (transcription) => {
            recordedChunks.current = [];
            setPushToTalkState("idle");
            const message = await sendFunction(transcription);
            setStartReadingFromMessageId(message.id);
          },
        );
      }
    }

    return () => {
      stopRecording(mediaRecorderRef);
    };
  }, [pushToTalkState]);

  useEffect(() => {
    if (inProgress === false && startReadingFromMessageId) {
      const lastMessageIndex = context.messages.findIndex(
        (message) => message.id === startReadingFromMessageId,
      );

      const messagesAfterLast = context.messages
        .slice(lastMessageIndex + 1)
        .filter((message) => message.role === "assistant" && message.content);

      const text = messagesAfterLast.map((message) => message.content).join("\n");
      playAudioResponse(text, context.copilotApiConfig.textToSpeechUrl!, audioContextRef.current!);

      setStartReadingFromMessageId(null);
    }
  }, [startReadingFromMessageId, inProgress]);

  return { pushToTalkState, setPushToTalkState };
};
