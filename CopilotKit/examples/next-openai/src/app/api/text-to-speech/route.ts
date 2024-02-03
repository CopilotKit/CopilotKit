
// import the playht SDK
import * as PlayHT from "playht";


export async function POST(req: Request): Promise<Response> {

  // Initialize PlayHT API with your credentials
  PlayHT.init({
    apiKey: process.env.PLAYHT_API_KEY || "",
    userId: process.env.PLAYHT_USER_ID || "",
  });
  
  // configure your stream
  const streamingOptions = {
    // must use turbo for the best latency
    voiceEngine: "PlayHT2.0-turbo" as const,
    // this voice id can be one of our prebuilt voices or your own voice clone id, refer to the`listVoices()` method for a list of supported voices.
    voiceId:
      "s3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json",
    // you can pass any value between 8000 and 48000, 24000 is default
    sampleRate: 24000,
    // the generated audio encoding, supports 'raw' | 'mp3' | 'wav' | 'ogg' | 'flac' | 'mulaw'
    outputFormat: 'mp3' as const,
    // playback rate of generated speech
    speed: 1,
  };


// Grab the generated file URL

  // read text from the request body
  const text = (await req.json()).text;
  const generated = await PlayHT.generate(text);
  
  // Grab the generated file URL
  const { audioUrl } = generated;

    // return the generated audio URL
    return new Response(JSON.stringify({ audioUrl }), {
        headers: {
            "content-type": "application/json",
        },
    });
}
