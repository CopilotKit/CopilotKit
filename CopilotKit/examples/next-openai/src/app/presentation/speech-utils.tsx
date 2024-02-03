"use client";
export function getVoice(language: string) {
  const voicesByLanguage = {};
  for (const voice of window.speechSynthesis.getVoices()) {
    const lang = voice.lang.split("-")[0];
    voicesByLanguage[lang] ||= [];
    voicesByLanguage[lang].push(voice);
  }

  const voices = voicesByLanguage[language] || voicesByLanguage["en"];
  for (const voice of voices) {
    if (language == "en" && voice.name.includes("Karen")) {
      // Karen sounds ok
      return voice;
    } else if (language == "de" && voice.name.includes("Anna")) {
      // Anna sounds quite good
      return voice;
    }
  }
  return voices[0];
}


export async function browserSpeak(speech: string, language: string | undefined): Promise<void | undefined > {
  if (window.speechSynthesis !== undefined) {
    const utterance = new SpeechSynthesisUtterance(speech);
    utterance.voice = getVoice(language || "en"); // Defaulting to English for simplicity

    const speechFinished = new Promise<void>((resolve) => {
      utterance.onend = function () {
        resolve();
      };
    });

    window.speechSynthesis.speak(utterance);

    await speechFinished;
  } else {
    return undefined;
  }
}

export async function playht_speak(speech: string, language: string | undefined): Promise<void | undefined> {
  // endpoint for mp3 stream: /api/text-to-speech
  const response = await fetch("/api/text-to-speech", {
    method: "POST",
    body: JSON.stringify({ text: speech, language }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  // grab audioUrl from response
  const audioUrl = (await response.json()).audioUrl;

  // create audio element and play
  const audio = new Audio(audioUrl);
  const speechFinished = new Promise<void>((resolve) => {
    audio.onended = function () {
      resolve();
    };
  }
  );
  audio.play();

  return speechFinished;
}